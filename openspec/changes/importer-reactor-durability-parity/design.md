## Context

The downloader shipped reactor durability in `2026-07-22-reactor-durability`: a durable `ParkedEffectStore`, per-stream fault isolation with exponential-backoff retry, a modeled landing for a spent budget, a startup re-drive pass, and a `StalledReadModel` exposed through the facade. The importer reactor (`packages/importer/src/application/import/reactor.ts`) got only a partial follow-up (a bounded retry budget that dead-letters on exhaustion), and that budget is an in-memory `Map<globalSeq, attempt>` — lost on restart. The two reactors also differ structurally: the downloader **parks-and-advances-past** a failing stream (its checkpoint moves on, later events of that stream queue behind the park, other streams flow); the importer **holds** the single global checkpoint at the failing head and relies on the fallback poll to re-drive it. This design brings the importer to functional parity without importing the downloader's whole scheduler.

Constraints: pure domain (no I/O in `src/domain`); errors as values (neverthrow); durable state behind ports wired only in composition; 100% coverage; no breaking changes to serialized events or the cross-module seam contracts; additive-only.

## Goals / Non-Goals

**Goals:**
- Make the importer reactor's retry budget durable so it survives restarts (a poison effect converges on its dead-letter across reboots instead of looping forever).
- Add a queryable stalled read model for dead-lettered imports, exposed as `stalled?: boolean` on the import status view via the facade.
- Mirror the downloader's proven port/table/read-model shapes closely enough that the two modules read as one design, diverging only where the hold-the-checkpoint model makes a downloader concept meaningless.

**Non-Goals:**
- Rewriting the importer reactor into the downloader's park-and-advance scheduler (exponential backoff, `due()` scheduling, a separate startup re-drive pass). The hold model already re-drives via the checkpoint.
- A web/UI attention surface for stalled imports (a follow-up, as `unified-attention-queue` was for the downloader). This change stops at the facade query.
- Widening the cross-package `SeamFeed` error shape (see Decisions — deferred).

## Decisions

### D1: A durable `ParkedEffectStore` keyed by `globalSeq`, replacing the in-memory attempts `Map`

New port `application/ports/parked-effect-port.ts` and SQLite adapter `adapters/sqlite/parked-effects.ts` over a `parked_effects` table in the importer's own event DB. The reactor's `handleRetryable` reads the current tally with `find(globalSeq)`, increments, and either `park`s the new tally (below budget → hold the checkpoint) or, on exhaustion, dead-letters and `clear`s. Reading the count from the store on every attempt means the budget is *always* durable — no separate boot-seed step is needed; a restart's drain re-reads the held checkpoint, re-drives the event, and `find` returns the persisted tally.

**Why keyed by `globalSeq` and not `streamId` (the downloader's key):** the importer holds the *global* checkpoint at the failing head, so at most one effect is ever parked at a time and the natural key is the held event's position. Keying by `streamId` would imply the downloader's advance-past-and-queue semantics, which the importer does not have.

**Why no `nextRetryAt`/`due()`:** the importer has no backoff scheduler; the reactor's existing fallback poll (5s) re-drives the held event. Adding a scheduler would be a control-flow rewrite for no behavioral gain given the hold model. `ParkedEffect` therefore carries `{ globalSeq, streamId, attempt, parkedAt, lastError }` — the downloader's shape minus `nextRetryAt`.

Alternative considered: keep the in-memory `Map` but rehydrate it at boot from a durable side table. Rejected — it duplicates the source of truth and reintroduces the drift class; reading straight from the store each attempt is simpler and strictly correct.

### D2: A `StalledReadModel` seeded from the dead-letter store, exposed via the facade

Mirror the downloader exactly: an in-memory `Set<streamId>` (`mark`/`clear`/`isStalled`), seeded at boot by `seedStalledReadModel` which prunes dead letters older than a retention horizon then marks each survivor's stream. The reactor marks a stream stalled when it dead-letters its effect, and clears it (and its dead letters, via `clearStream`) when a previously-stalled stream drives an effect successfully again. The facade's `getImport`/`listImports` join `stalled: true` onto the view via a `withStalled` helper (as the downloader's `withStalled` does), and the import status DTO gains an optional `stalled` field. The read model is in-memory because the facade's queries are synchronous; durable truth stays in the dead-letter store.

This requires widening the importer's `DeadLetter`/`DeadLetterStore` to match the downloader's: an optional `streamId` (additive column + in-place migration), plus `clearStream` and `prune`. The existing `record`/`list` callers (the HALT-policy seam subscription) are unaffected — `streamId` is optional and they pass none.

### D3: Reactor control flow stays "hold the checkpoint"; re-drive is the drain

No separate re-drive pass. On boot the reactor loads its checkpoint and drains; a held (parked) event sits at `checkpoint + 1` and is re-processed by that drain, then again on each fallback poll until it succeeds or its durable budget is spent. This is the importer analog of the downloader's startup re-drive, achieved for free by the hold model.

### D4 (deferred): `SeamFeed` error-shape widening

The downloader's `CatchUpSubscription` notes that precise per-event dead-lettering for a `park` consumer would need the feed error to carry the failing `globalSeq` (it exposes only `{ kind }`). This is **not needed here**: the importer runs only its HALT-policy acquisitions subscription (which holds, never park-dead-letters per event), and the reactor's own dead-letters know their `globalSeq` directly from the `StoredEvent`. Widening it now would touch the downloader producer, both subscriptions, and both contract tiers for zero present benefit. Deferred with this rationale recorded.

## Risks / Trade-offs

- **A `parked_effects` write on the hot path** → the clear on a successful commit is an indexed single-row delete against an at-most-one-row table; negligible. Parking only happens on a retryable failure.
- **In-memory stalled read model can drift from the durable dead letters within a process life** → same trade-off the downloader accepted; the durable truth is the dead-letter store and every boot re-seeds from it.
- **Keying by `globalSeq` diverges from the downloader's `streamId` key** → intentional and documented; the two reactors have genuinely different checkpoint semantics, so a shared key would be a false parity. The port shapes and read-model are otherwise identical.
- **Additive `dead_letters.stream_id` column on existing prod DBs** → handled by an in-place `ALTER TABLE … ADD COLUMN` migration guarded by a `table_info` probe, exactly as the downloader migrated the same column.

## Migration Plan

Additive and backward-compatible: the new `parked_effects` table is created on open; the `dead_letters.stream_id` column is added in-place if absent. Old dead letters simply have a null `stream_id` (they never seed a stalled mark). No data backfill, no rollback complications — reverting the code leaves harmless unused schema.

## Open Questions

None blocking. The web attention surface for stalled imports is a known, deliberately-scoped follow-up, not an open question for this change.

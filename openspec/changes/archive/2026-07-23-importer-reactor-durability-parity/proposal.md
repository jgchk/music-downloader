## Why

The downloader's reactor was hardened against a production stall class (`2026-07-22-reactor-durability`): a failing effect's retry budget is durable, a spent budget lands somewhere modeled, and a stalled acquisition is exposed by the status read model. The importer reactor never got that parity. Its retry budget is held **in memory** (a `Map` keyed by `globalSeq`), so it resets to zero on every restart — a permanently-failing effect (e.g. beets refusing a release on every attempt) re-retries from a fresh budget after each reboot and can wedge the importer's global checkpoint indefinitely, never reaching its dead-letter. And when it does dead-letter, the affected import is invisible: there is no queryable stalled read model, so operators and the UI cannot see an import that has given up.

## What Changes

- **The importer reactor's retry budget becomes durable.** A new `ParkedEffectStore` port (a `parked_effects` table in the importer's own event DB) persists the per-event attempt tally. The reactor reads/writes the count from the store instead of an in-memory `Map`, so the budget survives restarts and a poison effect converges on its dead-letter across reboots instead of looping forever.
- **A dead-lettered import is exposed as stalled.** A `StalledReadModel`, seeded from the dead-letter store at boot and marked when the reactor dead-letters an effect (cleared when a previously-stalled stream drives successfully again), surfaces `stalled?: boolean` on the import status view through the importer facade — the queryable operator/UI surface the downloader already has.
- **Additive-only durability plumbing:** the `dead_letters` table gains an optional `stream_id` column (so a reactor letter names its owning import) with an in-place migration; the import status DTO gains an optional `stalled` field. No serialized event or cross-context contract changes.
- **Deliberate divergence from the downloader, documented in design:** the importer reactor *holds* the single global checkpoint at the failing head rather than *parking-and-advancing-past* streams with exponential backoff and a separate startup re-drive pass. It therefore re-drives the held event naturally — the drain re-reads from the held checkpoint on the fallback poll and on boot — so there is no backoff scheduler, no `nextRetryAt`/`due`, and the durable tally is keyed by the held `globalSeq`.
- **Deferred (documented, not built):** widening the cross-package `SeamFeed` error to carry the failing `globalSeq`. It is only needed by a `park`-policy seam consumer; the importer runs only its HALT-policy acquisitions subscription, and the reactor's own dead-letters already know their `globalSeq` directly.

## Capabilities

### New Capabilities
<!-- none: this hardens the existing import lifecycle capability's guarantees -->

### Modified Capabilities
- `import-management`: add a requirement that a failing effect's bounded retry budget is durable across restarts and that a spent budget dead-letters visibly, exposing the owning import as stalled by the status read model — the importer analog of the downloader's `acquisition-lifecycle` "A failing effect stalls only its own acquisition, within a bounded retry budget", adapted to the importer's hold-the-checkpoint reactor model.

## Impact

- **packages/importer only.** New `ParkedEffectStore` port + SQLite adapter + `parked_effects` schema table; reactor budget durability (drops the in-memory attempts `Map`); `StalledReadModel` + boot seeding + facade/use-case/DTO wiring; `dead_letters.stream_id` additive column + migration; composition-root wiring. Domain untouched.
- **No breaking changes.** Additive column (`dead_letters.stream_id`), additive DTO field (`stalled`), new table and port. Serialized events and the cross-module seam contracts are unchanged.
- Integrates with the shipped `unified-attention-queue`: a stalled import is a human-attention item; this change exposes the read model behind the facade, and surfacing it in the web attention queue stays a follow-up (mirroring how `reactor-durability` exposed the read model and `unified-attention-queue` surfaced it separately).

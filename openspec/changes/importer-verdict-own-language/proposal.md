## Why

The bounded-context reviewer found the importer's **domain speaks the downloader's action-vocabulary** for one of its own resolution verbs. The `Resolution` union (`packages/importer/src/domain/import/events.ts`) carries `{ kind: 'reject-and-retry-download' }` — but "retry-download" is the *downloader's* action, not the importer's intent. The importer's own intent is "the delivered copy is unusable — reject it and record that fact"; whether that triggers a re-download is the consuming context's decision, reached behind its anti-corruption layer. The verb is load-bearing through `decide.ts`, `state.ts`, `react.ts`, the read-model history projection, and the in-process facade DTO (`facade/schemas.ts`, `facade/mapping.ts`).

Worse, the importer's **domain comments model the downloader's private invariant**: `decide.ts` (~:95) and `events.ts` (~:26, ~:250) narrate the sender's *stale-guard* and *acquisition-revival* rules — reasoning that lives on the downloader's side of the ACL and has no business in the importer's pure domain.

This change renames the verb to the importer's own language and strips the borrowed vocabulary, while honoring the no-breaking-change non-negotiable for the one place the token is serialized.

## What Changes

- **Rename the resolution verb** from the downloader's `reject-and-retry-download` to the importer's own `reject-unusable-delivery` across the domain (`Resolution`, `PendingRejection`, `decide`, `state`, `react`), the in-process facade DTO (`resolveReviewRequestSchema` verb, the `resolutionVerbSchema` history projection, `mapping.ts`), and the web BFF form surface (`packages/web`).
- **Keep the identity opaque.** The retained `acquisitionId` / delivered `candidate` stay exactly as they are — carried as opaque provenance echoed back on the `ReleaseVerdictRecorded` fact — but the importer stops *reasoning* about what the consumer does with them.
- **Tolerate legacy history additively.** Because the verb is a persisted event value (`ReviewResolved.resolution.kind` is stored verbatim in the importer's own SQLite event store), register the importer's first real upcaster — a `ReviewResolved` v1→v2 rewrite of the legacy token `reject-and-retry-download` → `reject-unusable-delivery` — and bump `CURRENT_SCHEMA_VERSION`. New events write the new token; legacy events read identically. The domain only ever sees its own language.
- **Strip the downloader-vocabulary comments** from the importer's domain and reframe them in the importer's own terms (opaque provenance echoed back; the consumer owns any retry/revival semantics).

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `match-review`: rename the resolution verb to the importer's own language and reframe its semantics — "right thing, bad copy": reject the delivered copy as unusable and record a release verdict — and add the guarantee that a review recorded under the legacy verb still projects and settles identically (tolerant read via upcast).
- `importer-outbound-events`: re-word the verdict trigger to the new verb name and codify that the published `release.verdict` payload and schema are **unchanged** by the rename — the cross-context wire never carried the verb, so no consumer is affected.

## Impact

- **NOT a cross-context wire break.** The published `release.verdict` event (importer outbound feed → downloader `verdict-consumer`) carries `verdict: 'rejected'` + `acquisitionId` + `candidate` + `reasons` — it has never carried the resolution verb string. The downloader's tolerant reader (`externalVerdictDataSchema`) and its ACL are untouched; **the downloader package needs no change**.
- **IS a persisted-event value in the importer's own store.** `ReviewResolved.resolution` is stored as raw JSON, so `"kind":"reject-and-retry-download"` is an immutable historical fact read back on every replay (the state fold's `settled`, the exhaustive `RecordIntakeDeleted` switch, the history projection). A naive rename would break replay of historical events → per the no-breaking-change non-negotiable and event-sourcing's immutable-facts rule, this is handled **additively** through the existing upcaster seam (schema-version bump + a v1→v2 upcaster). No data backfill, no rollback risk.
- **In-process only otherwise.** The facade request DTO and the web BFF form live in one deployable (the SvelteKit app); their rename is a coordinated compile-break across a single atomic deploy — a synchronized web-BFF update, not a wire break.
- **No breaking changes.** Additive upcaster + coordinated in-process rename; no external consumer, no persisted read-model table (the status projection is in-memory, rebuilt from the upcast log).
- Packages touched: `importer` (domain, `adapters/sqlite` upcaster + composition wiring, facade), `web` (forms/components). No `downloader` change.

## Context

The acquisition detail page (`packages/web/src/routes/acquisitions/[id]/+page.server.ts`) reads only the downloader facade. The downloader's acquisition history therefore stops at a terminal hand-off verdict — `imported` ("Deposited at {location}") or `fulfillment-rejected` — and shows nothing of the import that follows.

The middle is not missing; it is unjoined. The two contexts already integrate through the seam:

- The downloader emits `acquisition.fulfilled` carrying `acquisitionId` (= its acquisition stream id). The importer's intake consumer ingests it and stores `acquisitionId` on `ImportRequested.source`, indexing it as `ImportStatusProjection.acquisitions: Map<acquisitionId, importStreamId>` (`importIdForAcquisition`, `packages/importer/src/application/projections/read-models.ts:117`).
- The importer records a full narrative history (`requested`, `proposed`, `auto-apply-selected`, `review-required`, `review-resolved`, `applied`, `remediation-required`, `rejected`, `release-verdict-recorded`) exposed via `getImport`/`listImports` (`packages/importer/src/facade/facade.ts`).
- On `reject-and-retry-download`, the importer emits `release.verdict` (`acquisitionId`) back over the seam; the downloader revives the acquisition, so a rejected import can be followed by a fresh download/import round.

Every stored event in both contexts already carries `occurredAt` (ISO-8601) on its `StoredEvent` envelope (`event-store-port.ts:13`). Both status projections receive that envelope but currently discard the timestamp, folding over bare domain events.

Constraints (non-negotiables): the domain stays pure; dependencies point inward; no breaking changes to published contracts (additive only); errors are values; test-first with 100% merged coverage; the two bounded contexts integrate only through the seam, never through a shared read model or a direct code dependency.

## Goals / Non-Goals

**Goals:**
- Show the acquisition's whole life — download through library import — as one chronological, module-attributed timeline on the acquisition detail page.
- Correctly interleave the retry ping-pong (import rejection → revived acquisition → re-download → re-import) using real event timestamps.
- Make an import retrievable by its originating acquisition id, cheaply, without scanning all imports.
- Resolve the "Deposited at {location}" label collision between the two contexts.
- Keep the join web-side, degrading each context's section independently.

**Non-Goals:**
- No new seam events and no change to `acquisition.fulfilled` / `release.verdict` schemas.
- No teaching the downloader read model about import detail (that would couple the contexts).
- No new importer-owned UI route (`/imports/[id]`); the timeline lives inline on the acquisition page.
- No re-timestamping of history; we surface the `occurredAt` that already exists.
- No change to which downloader/importer events surface as history or to their carried detail.

## Decisions

### D1: The join lives in the web layer, composed from both facades

The acquisition detail loader calls `downloader.getAcquisition(id)` and `importer.getImportForAcquisition(id)` in-process and merges them, mirroring the attention-queue composition (`reviews/+page.server.ts`). Alternatives rejected: (a) enrich the downloader read model with import detail — couples two bounded contexts through one read model and duplicates the importer's system of record; (b) a new cross-context event carrying import steps back to the downloader — needless coupling and write amplification for a pure read concern. Web-side composition keeps the seam intact: no new contract between the modules, only the web BFF depending on both facades (which it already does).

### D2: Correlate by acquisition id via a new importer facade read over the existing index

Add `getImportForAcquisition(acquisitionId)` to the importer facade, backed by `importIdForAcquisition` (O(1) index lookup) → `get(importId)`. Return a modeled not-found when absent. The import status view/DTO also carries `acquisitionId` (present when the import arrived from an acquisition) so the web layer can label and correlate without re-deriving the importer's content-addressed `imp-<sha256(dir)>` id. Alternatives rejected: (a) `listImports().find(...)` web-side — O(all imports) per page view and still needs the DTO field; (b) web re-deriving `importIdFor(directory)` by re-rooting the path and hashing — leaks the importer's addressing scheme into the web layer and is brittle.

### D3: Surface `occurredAt` as a per-entry `at` on both history contracts

Both status projections already receive the `StoredEvent`; retain its `occurredAt` alongside each projected history entry and add an additive `at: string` (ISO-8601) to each entry in both wire schemas (`downloader/src/facade/schemas.ts` history entries; `importer/src/facade/schemas.ts` `historyEntrySchema`). The merge helper sorts the concatenated, module-tagged entries by `at`. Timestamps — not positional concatenation — are what make the retry ping-pong interleave correctly; on the happy path they agree with source order anyway. Alternative rejected: concatenate "download section then import section" without timestamps — simpler but wrong for rejected-and-retried acquisitions, which the user explicitly wants correct.

### D4: Independent-degrade composition

The importer read is guarded the way the attention surfaces are (`facade-reads.ts` pattern): a not-found (no import yet) and an unavailable read are distinct, modeled outcomes, both rendering the downloader timeline plus a non-failing note, never a page error. "No import yet" is the normal state for an acquisition still downloading.

### D5: Disambiguate the hand-off vs library-import labels

The downloader's `imported`/hand-off entry renders as *staged / handed off to importer* (its location is the intake/staging path); the importer's `applied` entry renders as *imported into the library* (its location is the beets library path). The component labels each explicitly so the two `location` values are never conflated.

### D6: Test-first, contract-aware

Red-green per the constitution. New contract-test surfaces: the `getImportForAcquisition` read and the added DTO fields (`at`, `acquisitionId`) need a recorded fixture + replay so the shape is pinned, not just unit-stubbed. Coverage stays at 100% merged across the web package's three vitest projects (server/ssr/client) and each module package.

## Risks / Trade-offs

- **Clock skew / ordering ties between the two SQLite stores** → both timestamps come from the same host process wall clock; ties are broken by a stable secondary key (module then source order) so the sort is deterministic and never throws away an entry.
- **Additive DTO fields ripple into contract fixtures** → treat as a first-class task; record the new shapes rather than hand-editing fixtures, and run the contract tier.
- **`acquisitionId` is optional on the import view** (a manually-submitted import has none) → the field is additive-optional; the web timeline only asks the importer for imports it already correlated by acquisition id, so absence is benign.
- **Timeline could grow long on a much-retried acquisition** → acceptable for now; the entries are bounded by the acquisition's own bounded retry ladder. Pagination/collapse is a later cosmetic concern, not in scope.
- **Two projections change in parallel** → the timestamp-threading is mechanical and identical in shape on both sides; each is covered by its own failing test first.

## Migration Plan

Pure additive read change: new facade method, added optional/added DTO fields, web composition. No data migration, no event rewrite, no seam-schema change. Deploys as one image; rollback is reverting the change with no residual state (the read models rebuild from the unchanged logs). Ships through the normal merge-to-main → GHCR image → homelab deploy path.

## Open Questions

- None blocking. Deferred by choice: a dedicated `/imports/[id]` route (out of scope, D-Non-Goals) and timeline collapse/pagination for very long retried acquisitions.

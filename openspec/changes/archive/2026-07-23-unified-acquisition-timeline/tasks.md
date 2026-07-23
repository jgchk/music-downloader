## 1. Importer — timestamps on the status history (test-first)

- [x] 1.1 Failing test: `ImportStatusProjection.apply` retains each event's `occurredAt`, and the projected `StatusHistoryEntry` carries it (`packages/importer/src/application/projections/read-models.test.ts`).
- [x] 1.2 Thread `occurredAt` from the received `StoredEvent` through `apply`/`projectStatus` onto each `StatusHistoryEntry` (`read-models.ts`); the projection already receives the envelope — stop discarding the timestamp.
- [x] 1.3 Failing test: `historyEntrySchema` accepts and requires an additive `at` (ISO-8601) on every entry; DTO round-trips it (`packages/importer/src/facade/schemas.ts` + mapping tests).
- [x] 1.4 Add `at` to `historyEntrySchema` and thread it in `facade/mapping.ts` (`statusViewToDto`).

## 2. Importer — retrieve an import by acquisition id (test-first)

- [x] 2.1 Failing test: importer facade `getImportForAcquisition(acquisitionId)` returns the same status view as `getImport(importId)` for a correlated import, and a modeled not-found when no import exists for the acquisition (`packages/importer/src/facade/facade.test.ts`).
- [x] 2.2 Add a use case over `importIdForAcquisition` (O(1) index) → `get(importId)`; wire `getImportForAcquisition` into `ImporterFacade` (`facade.ts`, `use-cases.ts`).
- [x] 2.3 Failing test: the import status view/DTO carries `acquisitionId` when the import arrived from an acquisition, and omits it otherwise.
- [x] 2.4 Surface `acquisitionId` on `ImportStatusView` and `importStatusResponseSchema` (additive-optional), threaded from `ImportRequested.source.acquisitionId`.

## 3. Downloader — timestamps on the acquisition history (test-first)

- [x] 3.1 Failing test: the acquisition status projection carries each history entry's `occurredAt` (`packages/downloader/src/application/projections/read-models.test.ts`).
- [x] 3.2 Thread `occurredAt` from the `StoredEvent` onto each `StatusHistoryEntry` in the downloader projection (`read-models.ts`).
- [x] 3.3 Failing test: the acquisition history DTO carries an additive `at` (ISO-8601) per entry (`packages/downloader/src/facade/schemas.ts` + `mapping.ts` tests).
- [x] 3.4 Add `at` to the downloader history entry schema and thread it in `facade/mapping.ts` (`historyEntryToDto`).

## 4. Contract tier — pin the new read shapes

> Reconciled during implementation: the repo's contract tier covers only external/seam contracts
> (MusicBrainz, slskd, beets-bridge, and the `acquisition.fulfilled`/`release.verdict` seam events),
> none of which changed. The facade DTOs are an internal in-process boundary consumed by the web
> BFF; their new fields (`at`, `acquisitionId`) and the `getImportForAcquisition` read are pinned by
> the facade zod-schema and mapping unit tests (Groups 1–3), not by a recorded external fixture. No
> contract fixture change was needed; the contract suite stays green (verified in the gate).

- [x] 4.1 Confirm the importer facade additions are covered by the facade schema/mapping unit tests; no external fixture applies.
- [x] 4.2 Confirm the downloader acquisition history `at` field is covered by the facade schema/mapping unit tests; no external fixture applies.

## 5. Web — unified timeline composition (test-first)

- [x] 5.1 Failing test: a merge helper in `packages/web/src/lib` tags each history entry with its module (`downloader`/`importer`), concatenates the two histories, and sorts by `at` with a deterministic tie-break (module then source order).
- [x] 5.2 Implement the merge/sort helper.
- [x] 5.3 Failing test: the acquisition detail loader composes `downloader.getAcquisition(id)` with `importer.getImportForAcquisition(id)` behind an independent-degrade guard — no import yet and unavailable are distinct, both keep the page up (`[id]/page.server.test.ts`).
- [x] 5.4 Update `[id]/+page.server.ts` to fetch and merge both facades, guarded like the attention surfaces; pass the unified timeline + import-section status to the view.

## 6. Web — render the timeline (test-first)

- [x] 6.1 Failing SSR test: `AcquisitionDetail` renders the merged timeline in occurrence order, each entry attributed to its module, covering the happy path and the rejected-and-retried interleave (`AcquisitionDetail.ssr.test.ts`).
- [x] 6.2 Failing SSR test: the hand-off entry reads as staged/handed-off and the importer `applied` entry reads as imported-into-library — the "Deposited at {location}" collision is resolved with each naming its own location.
- [x] 6.3 Failing SSR test: when the import section degrades (no import / unavailable), the downloader timeline still renders with a modeled note and no page error.
- [x] 6.4 Implement the `AcquisitionDetail` timeline rendering, module attribution, corrected labels, and degraded-section note.

## 7. Verify & gate

- [x] 7.1 `pnpm check` green (format, lint, typecheck, build, test) with 100% merged coverage across affected packages; no new coverage carve-outs.
- [x] 7.2 Confirm no published seam schema changed (`acquisition.fulfilled`, `release.verdict` untouched) and every wire change is additive.
- [x] 7.3 Drive the flow end-to-end (a fulfilled-then-imported acquisition, and a rejected-and-retried one) and confirm the detail page shows one correctly-ordered, module-attributed timeline.

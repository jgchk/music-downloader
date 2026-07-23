## Why

On the acquisition detail page the history stops at the download boundary: the last thing a user sees is "Deposited at {location}", after which the entire import — beets matching, the human review queue, apply-or-reject into the library — happens invisibly in the importer module. The full narrative already exists (the importer records a rich, event-sourced history and the downloader's `acquisitionId` is carried the whole way through and back), but the web view never joins the two contexts, so a fulfilled-then-imported release looks stalled and a rejected import is untraceable from the acquisition it came from.

## What Changes

- The acquisition detail page presents **one chronological timeline spanning both bounded contexts** — the downloader's steps (selected, downloaded, validated, handed off) and the importer's steps (requested, matching, review required, review resolved, applied/rejected, retry-download verdict) — merged and ordered by occurrence time, with each entry labelled by its originating module.
- The importer facade gains a read that returns an import **by its originating acquisition id**, backed by the reverse index the intake seam already maintains (`importIdForAcquisition`). The import status DTO carries its `acquisitionId` so the correspondence is explicit on the wire.
- Both modules' history read entries carry an **occurrence timestamp** (`at`, ISO-8601), surfaced from the `occurredAt` already stamped on every stored event, so the web layer can interleave the two histories correctly — including the retry ping-pong where an import rejection revives the acquisition for another download/import round.
- The web layer composes the two facade reads **in-process, web-side** (the same pattern as the attention queue), degrading each section independently: a missing or unavailable import renders as "import not started / momentarily unavailable", never a page failure, and never a new cross-context contract between the modules.
- The "Deposited at {location}" label collision is resolved: the downloader's hand-off reads as *staged / handed off to importer*, the importer's `applied` reads as *imported into the library*, so the two locations are no longer conflated.
- All wire changes are **additive** (new facade read, new optional/added fields on existing DTOs) — no breaking change to any published contract.

## Capabilities

### New Capabilities
<!-- None. This joins detail already produced by existing capabilities; the timeline lives in web-ui. -->

### Modified Capabilities
- `web-ui`: the acquisition detail SHALL present the full download-through-import lifecycle as one timeline composed web-side from both module facades, degrading each section independently, with module-attributed and unambiguously-labelled entries.
- `import-management`: the importer's reads SHALL expose an import by its originating acquisition id, SHALL carry that acquisition id on the import status view, and each history entry SHALL carry its occurrence timestamp.
- `acquisition-lifecycle`: each entry of the acquisition status read model's history SHALL carry its occurrence timestamp.

## Impact

- **Importer** (`packages/importer`): facade + status projection — a new `getImportForAcquisition` facade read over the existing `importIdForAcquisition` index; `acquisitionId` and per-entry `at` added to the import status DTO/schema; the status projection retains `occurredAt` from the `StoredEvent` it already receives.
- **Downloader** (`packages/downloader`): status projection + facade — per-entry `at` added to the acquisition history DTO/schema, threaded from `StoredEvent.occurredAt`.
- **Web** (`packages/web`): the acquisition detail loader composes the importer facade alongside the downloader facade behind an independent-degrade guard; a merge/sort helper builds the unified timeline; the `AcquisitionDetail` component renders module-attributed entries and the corrected labels.
- **Contracts/tests**: the new importer facade read and the added DTO fields are contract-test surfaces (recorded fixture + replay). 100% merged coverage gate applies; every production line is preceded by a failing test (test-first). No published event schema changes — the seam events (`acquisition.fulfilled`, `release.verdict`) are untouched.

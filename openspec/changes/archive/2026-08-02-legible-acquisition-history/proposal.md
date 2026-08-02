# Legible acquisition history

## Why

The acquisition detail page's History view reads like a debug log wearing a UI: entries leak internal vocabulary ("Import Import requested", "Download failed (TransferError)", "distance 0.1363750628456511"), per-entry timestamps exist in the read models but are never rendered, and — worst — the downloader facade projects no history before a candidate is selected and none of the terminal outcomes, so a just-started acquisition shows an empty list captioned "Nothing has happened yet." and a *failed* acquisition shows the same shrug. The result feels machine-generated and leaves the user asking "is anything actually happening?"

## What Changes

- **Downloader facade history gains curated milestone kinds (additive):** `requested`, `resolved`, `search-started`, and terminal kinds (`fulfilled`, `exhausted`, `conflicted`, `metadata-failed`, `cancelled`) join the existing five, so history covers request → resolution → search → attempts → hand-off → ending. Noise events (`CandidatesRanked`, `ValidationPassed`, `DownloadCompleted`, `CandidateRejected`) deliberately stay out; a rejection is implied by the failure row that precedes it.
- **The timeline speaks in one narrator voice under an explicit copy register:** past-tense verb-led fragments for completed entries, a single present-progressive synthesized "now" row while the acquisition is active, no first person, no internal vocabulary (enum names, architecture nouns like "importer"/"staged"), human-formatted numbers (match distance becomes a glossed percentage). The per-entry "Import" module tag is removed from rendered text (module attribution survives only as a DOM attribute for styling/tests).
- **Timestamps are rendered:** hybrid format (relative under 24h, absolute after, full date-time on hover via `<time datetime title>`), flat chronological order, date dividers, duration summary in the closing row.
- **Diagnostic detail moves behind per-entry native `<details>` disclosure:** raw remote paths, raw reason codes, staging paths. Short human identifiers (peer username, album title, candidate count) stay inline. The library location is presented labeled in the page header, not buried.
- **Terminal outcomes become explicit closing rows** with plain-English reasons and one honest remediation hint where a real action exists. "Nothing has happened yet." becomes unreachable for real acquisitions.
- **The detail page becomes live while active:** client-side interval re-fetch (SvelteKit `invalidateAll`) while the acquisition is non-terminal, built behind a swappable freshness-driver seam so a future push (SSE) change replaces the trigger, not the views. The layout's "freshness is page-navigation freshness" design note is amended.
- **The rest of the detail page adopts the same register:** status line loses raw enums and gains correct plurals, the orphan staging-path/enum paragraph is reworked, the queue sidebar's "1 attempts" grammar is fixed, and terminally-failed never-resolved acquisitions stop displaying "(resolving…)" as their permanent title.
- **All three skins get deliberate timeline styling** over structural anatomy defined once at the token/skeleton layer (forum, the daily driver, gets the finishing pass).
- Clears two recorded loose ends: the "Import Import requested" collision and the stale "retry-download verdict" label.

## Capabilities

### New Capabilities

None — every change lands in an existing capability.

### Modified Capabilities

- `acquisition-lifecycle`: the acquisition status read model's history requirement changes from "the five attempt-level entries" to curated lifecycle coverage — new additive entry kinds for request, resolution, search start, and every terminal outcome; the existing "history entries carry occurrence time" requirement's "SHALL NOT change which events surface" constraint is superseded by this change.
- `web-ui`: the timeline requirement changes — module attribution becomes non-textual (unified narrator voice), a synthesized in-progress row is required while active, hybrid timestamps are required, terminal rows are required, copy register requirements are introduced, the failure-reason presentation requirement is revised (human reason stays in the visible row; raw diagnostic codes move behind per-entry disclosure — distinct content, so no duplicated-reveal), and the detail page gains a liveness requirement (interval re-fetch behind a swappable freshness seam).
- `import-management`: the import status read model additively exposes decided settledness (`settled`), so the web layer paces the detail page's liveness off the importer's own terminality instead of re-deriving it from the phase enum.
- `web-ui-presentation`: the semantic skeleton gains timeline anatomy (marker slot, meta alignment, pending-row state, per-entry disclosure) defined at the token/skeleton layer, with all three skins theming it.

## Impact

- `packages/downloader/src/application/projections/read-models.ts` — history projection emits the new kinds.
- `packages/downloader/src/facade/schemas.ts` + `mapping.ts` — additive DTO union members (no breaking change; api-compatibility additive-only rule applies), schema/mapping tests.
- `packages/web/src/lib/components/AcquisitionDetail.svelte`, `src/lib/timeline.ts`, `src/lib/acquisitions.ts`, detail route — copy system, pending row, timestamps, disclosure, liveness driver, status-line/queue fixes.
- Skin CSS in `packages/web` (token layer + forum/glass/terminal).
- Evidence base: `docs/research/timeline-ux-best-practices.md` (cited UX research backing register, timestamps, disclosure, and in-progress affordance decisions).
- One additive importer facade field (`settled` on the import status DTO — review finding: the BFF must not re-derive the importer's terminality); no cross-module contract is introduced (web-side composition unchanged in principle).
- Out of scope: `/reviews` surface, SSE push (explicit future change), role-split rendering.

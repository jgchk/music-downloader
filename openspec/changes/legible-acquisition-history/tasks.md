# Tasks — legible-acquisition-history

TDD throughout: every task's production code is preceded by its failing test; 100% coverage holds
at every commit; `pnpm check` gates each commit. Facade work lands before web work consumes it.

## 1. Downloader facade: lifecycle history kinds (D1, D2)

- [x] 1.1 Extend the history projection (`application/projections/read-models.ts`) to emit
  `requested` (carrying the request target as given), `resolved` (artist/title/year),
  `search-started` (round), and terminal kinds `fulfilled` (location), `exhausted`, `conflicted`
  (location), `metadata-failed`, `cancelled` — tests first, including: fresh acquisition has a
  `requested` entry; each terminal story ends with its terminal entry; noise events
  (`CandidatesRanked`, `ValidationPassed`, `DownloadCompleted`, `CandidateRejected`) still
  surface nothing; entries carry `at` from the stored event.
- [x] 1.2 Add the new kinds to the facade schema (`facade/schemas.ts`) as additive
  discriminated-union members and map them (`facade/mapping.ts`); schema + mapping tests; confirm
  the additive-only compatibility posture (existing DTO fixtures still parse).
- [x] 1.3 Additively expose the requested target on the acquisition list read model + list DTO
  (for titling never-resolved acquisitions, D10); tests for a metadata-failed, never-resolved
  acquisition carrying its descriptor.
- [x] 1.4 Verify a pre-existing recorded stream (fixture from a real event sequence) folds into
  the full new history with no migration — regression test pinning retroactivity.

## 2. Web: copy system (D3, D4)

- [x] 2.1 Create the copy module (single source of all timeline/status strings): entry-kind →
  layer-1 string builders per the D4 tables, the `DownloadFailureReason` gloss map with generic
  fallback, resolution glosses (`apply-candidate`, `reject-unusable-delivery`, unknown), and the
  match-percentage gloss (`round((1 − distance) × 100)`); unit tests assert register conformance
  (no enum identifiers, no banned architecture nouns, tense/case rules) across every kind
  including unknown-kind fallbacks.
- [x] 2.2 Rewrite `AcquisitionDetail.svelte`'s timeline rendering to consume the copy module:
  unified voice, no rendered module tag (keep `data-module`), new downloader kinds rendered,
  importer rows re-copied (fixes "Import Import requested" and the stale "retry-download verdict"
  label); component tests per kind.
- [x] 2.3 Layer-2 disclosure: per-entry native `<details>/<summary>` rendered only when the entry
  has diagnostic payload (remote paths, raw codes, staged path, raw distance); tests: payload
  entries expose it, payload-free entries render no control.

## 3. Web: time and the in-progress row (D5, D6)

- [x] 3.1 Timestamp rendering: `<time datetime title>` on every entry, hybrid display (relative
  < 24h with "now" < 60s, absolute after), date divider rows on calendar-date change, coarse
  duration gloss on the closing entry of a terminal acquisition; pure date-format utilities with
  unit tests (fixed clock injected — no wall-clock reads in components).
- [x] 3.2 Synthesized in-progress row: derive from downloader status (+ importer status after
  hand-off) per the D5 table; exactly one, tail position, present-progressive copy,
  attention-styled variants for awaiting-selection/awaiting-review with links; none when
  terminal; tests per status including the just-submitted case (requested + pending row, never
  empty).
- [x] 3.3 Fold the ProgressBar into the downloading in-progress row, including the
  progress-unavailable sentence inside the row; remove the standalone placement; tests.
- [x] 3.4 Retire "Nothing has happened yet."; defensive no-entries fallback becomes the D5
  neutral string; import-unavailable indication re-worded to the unified voice; tests.

## 4. Web: page register and titles (D9, D10)

- [x] 4.1 Status line rework: badge + human phrase map (D9), pluralized counts with zero-count
  segments omitted; no raw enums anywhere on the page; tests across statuses.
- [x] 4.2 Replace the orphan location/enum paragraph with the labeled library-location line
  (present only when `location` exists); failure accounts live only in the timeline's terminal
  row; tests.
- [x] 4.3 Queue sidebar: pluralize attempts, hide at zero; title fallback chain (resolved target →
  requested descriptor → neutral unknown-release label), "(resolving…)" only while genuinely
  `Pending`; tests including a metadata-failed id-only request.

## 5. Web: liveness (D8)

- [x] 5.1 Freshness-driver seam: a page-layer module with `start/stop` semantics wrapping
  interval `invalidateAll()` (~5s), running only while the acquisition is non-terminal, torn down
  on navigation; unit tests with fake timers; component wiring test that presentation consumes
  page data only (driver swappable without touching views).
- [x] 5.2 Amend the "freshness is page-navigation freshness" design comment in
  `+layout.server.ts` to record the revision and the SSE-successor intent.

## 6. Skins (D11)

- [x] 6.1 Skeleton/token layer: timeline anatomy hooks (marker slot, content, time, pending
  state, attention/failure/success states, date divider, disclosure) + semantic marker tokens;
  DOM identical across skins; tests/lint per web-ui-presentation rules.
- [x] 6.2 Theme the anatomy in all three skins — forum first (receipt-like finishing pass), then
  glass and terminal; no browser-default-styled timeline under any skin; visual pass over real
  data on all three.
- [x] 6.3 Accessibility checks: entry text carries state without color, `<details>` keyboard
  operation, `time` metadata present — under each skin.

## 7. Verification and ship

- [x] 7.1 Update affected e2e/Playwright expectations (detail page text assertions, timeline
  presence) and the out-of-process e2e where it asserts history copy.
- [x] 7.2 `pnpm check` clean at 100% coverage; contract/drift tiers green.
- [ ] 7.3 Live verification on flight against real acquisitions: the Smokey/Willie/failed/(never
  -resolved) pages from the review session read correctly — full story, timestamps, no enums, no
  "Import Import", terminal endings present, pending row advances on an active acquisition.
- [ ] 7.4 Release prep (`feat`, minor), PR, merge, deploy per /ship lifecycle.

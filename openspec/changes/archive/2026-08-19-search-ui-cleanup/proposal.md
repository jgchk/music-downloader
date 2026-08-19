# Search-first request page — cleanup pass

## Why

The shipped search-first request page (v3.21.0, `2026-08-19-search-first-request-ui`) was audited
against the interaction model it was built from — prototype D (`proto-d-hybrid.html`), driven side
by side with the real page in a browser on 2026-08-19 — and the findings were grilled to decisions
the same day. The page-breaking CSS defects ship separately and first as `search-ui-anatomy-fix`
(this change builds on it). What remains here is the interaction parity the first draft quietly
lost, plus two robustness gaps the audit exposed:

- An artist result opens a cramped text-only side panel with blind Request buttons; the prototype
  browses the discography in place as an artwork grid whose albums are themselves openable.
- Requesting anything navigates away to the download's page, so requesting three albums costs
  three searches; the prototype confirms in place.
- All 25 fetched results per kind render as a wall; the prototype showed a scannable head, and the
  wall also buries the other kinds and fires ~75 artwork requests per settled keystroke.
- The album detail view lost its context line, its identifier, its format filter, and its
  always-visible best-match summary — the pipeline's default can sit invisible inside a collapsed
  edition group. The track detail view lost its artwork and context entirely.
- The detail view can only be dismissed from inside itself; a catalog failure surfaces as a
  generic "Something went wrong"; the pre-search hint dropped its example identifier; the artist
  card's subline says the literal word "Artist".
- Under a slow or unreachable Cover Art Archive, every tile independently waits out the proxy's
  full timeout, six at a time; the archive's base URL is the one upstream not configurable from
  the environment.

## What Changes

- **Artist results browse in place.** Opening an artist replaces the results area with the artist
  discography view — the same artwork grid search results use, headed by the artist's name, with
  a one-step way back to the held results (no re-search). Each entry carries one-click Request
  and opens the standard album detail view. Typing exits the browse (it is just a new search);
  activating a filter tab exits it and applies that filter to the held results.
- **Requesting stays on the page.** Result-borne request forms submit to a named action that
  answers with the new download's identifier instead of redirecting; the confirmation renders at
  the form that sent it, naming the download with a way to open it. Only the submitting form goes
  busy; the no-JS fallback form keeps its full-page round trip.
- **The mixed view shows each kind's top results** (10 albums / 6 artists / 6 tracks, web-side
  constants) while each kind's filter tab shows everything fetched — a pure view decision; the
  catalog-search read keeps returning its full ranked lists unchanged. Section headings state the
  trim honestly as a link-styled "10 of 25" that applies that kind's filter.
- **The album detail view gets its context back**: an artist · year · type line, the release-group
  identifier, format filter chips that filter editions and regroup (prototype behavior), and an
  always-visible best-match summary that both names the pipeline's pick (or the
  selection-required outcome) and serves as the "let the system choose" control; the pick's group
  opens alongside the most-common one. The track detail view gets its artwork and its
  artist · release line. "Pinning" is retired for the settled term **chosen edition** — in copy
  and in code names.
- **The detail view dismisses like the non-modal panel it is** (per the modality research: the
  Linear-peek genre is non-modal, and scrim-or-trap middle states are the harmful ones): Escape
  closes it from anywhere on the page, clicking outside closes it, no scrim, `aria-modal` stays
  false, focus returns to the originating result on close, and the panel contains its own
  overscroll.
- **Failure and empty states say the useful thing**: the facade's infrastructure refusals split
  transient from permanent on the wire (502 vs 500), the page words a transient one as
  "the catalog didn't answer — pause, or press Enter to retry" and a permanent one in the existing
  that-is-a-bug register; the pre-search hint regains a pasteable example identifier; the artist
  card's subline falls back to the artist's type (an additive DTO field) before any placeholder
  word; the search input autofocuses, and filter tabs return focus to it.
- **The cover-art proxy degrades gracefully**: an unreachable archive is remembered archive-wide
  for a short interval (never as absence), so a page of tiles fails fast instead of serializing
  timeouts; the archive base URL joins the environment schema.
- **Non-goals:** the anatomy/CSS repairs (shipped by `search-ui-anatomy-fix`), popularity-aware
  ranking, real artist imagery, refine-search, request-rate ceilings, edition-selection policy
  changes, and a modal mobile bottom sheet (recorded follow-up: if the non-modal sheet proves
  confusing in use, the researched path is native `dialog.showModal()` for the narrow
  presentation only).

## Capabilities

### Modified Capabilities

- `web-ui`: the request-page requirement grows the settled affordances — the artist discography
  view with dig-in, stay-on-page request confirmation with per-form busy state, top results with
  honest "N of M" heading affordances, detail-view context (subtitle, identifier, format filter,
  the always-visible best-match summary as the system-chooses control, track context), non-modal
  dismissal with focus return, retry-guiding failure copy distinct from drift, and the example
  identifier in the pre-search hint.
- `catalog-search`: the artist search result carries the artist's type where the catalog states
  one (additive DTO field; the UI's fallback line).
- `cover-art`: an unreachable archive is remembered briefly — distinct from and much shorter than
  confirmed absence — so bursts of lookups fail fast while art stays re-findable.

Two existing scenario headings keep their wording — "Dig-in request with a pinned edition" and
"The default edition is visible before requesting". The archiver reads a renamed scenario as a
dropped one, so a heading can only change when its requirement is next restated wholesale; their
prose and every scenario added here use the settled language.

## Impact

- **`packages/web`**: the bulk — `RequestSearch`/`CatalogResults`/`CatalogDetail` and the
  `lib/search` modules (browse state, top-results trim, detail context, chosen-edition rename,
  dismissal, named-action confirmation, failure-copy mapping); `facade-errors` status split;
  cover-art cache memo + `COVER_ART_BASE_URL` in the environment schema.
- **`packages/downloader`**: the artist DTO's additive `type` field with a contract fixture
  proving the consumed field; nothing else — ranking, limits, and reads are untouched.
- **Contracts:** additive only (artist `type`; the 502 status for transient infrastructure
  refusals is a widening the client already tolerates). The submit contract is untouched — the
  named action changes the answer's presentation, not the command.
- **Tests:** the e2e/parity blast radius must be audited before merge — the post-submit
  navigation change and the copy changes are exactly the out-of-diff breakage the scraping tiers
  exist to catch (known hazard; the e2e gate runs only on main).
- **Dependencies:** `search-ui-anatomy-fix` merged first (this change styles surfaces the
  inversion creates and reuses its layout tests).
- **Release semantics:** `feat` (minor), with the matching `version:prep` bump; one PR.

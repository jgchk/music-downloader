# Tasks — search-first request page

All production code test-first (red before green), per `docs/development/testing.md`.

## 1. Catalog-search core (downloader)

- [x] 1.1 Record contract fixtures for the newly consumed MusicBrainz shapes: release-group/artist/recording entity search, release browse by release-group with media, release lookup with recordings (tracklist); extend the live recorder scripts and replay tests in `packages/downloader/test/contract`
- [x] 1.2 Add zod response schemas for the new MB shapes in `adapters/musicbrainz/schemas.ts` (tolerant readers, consumed fields only)
- [x] 1.3 Port the prototype's ranking as pure functions with table-driven tests: pair score (artist-credit token coverage, subtitle-noise penalty, secondary-type penalty, type bonus, MB-score tiebreak), artist ranking with matched-name-length tie-break, recording ranking ("paul simon graceland" fixture must rank Graceland/Paul Simon first)
- [x] 1.4 Implement intent ordering (exact artist name → artists; best recording > best album-shaped RG + margin, Singles excluded from album evidence → recordings; else release groups) with the three canonical query fixtures as tests
- [x] 1.5 Define the catalog-search port (search, resolve-by-id, browse artist, list editions, get tracklist) and implement the MusicBrainz adapter over the shared User-Agent-identified client, with short-TTL query caching and in-flight sharing (no pacing queue — it would serialize a search's entity reads; see the corrected stewardship requirement)
- [x] 1.6 Implement the best-match preview by reusing `releaseGroupEditionIds` on the browse result (head of its output, or the explicit no-automatic-pick outcome); test that preview and pipeline agree on shared fixtures
- [x] 1.7 Expose the facade read verbs (`searchCatalog`, `browseArtist`, `listEditions`, `getTracklist`) with zod boundaries, modeled failures distinct from empty results, and wire them in composition

## 2. Cover art (downloader + web)

- [x] 2.1 Record CAA contract fixtures (manifest hit, confirmed 404) and add the Cover Art Archive port/adapter in the web package; upstream failure modeled separately from confirmed absence
- [x] 2.2 Implement the web artwork endpoint (`/cover-art/<entity>/<mbid>`) serving through a byte-budgeted cache; art and confirmed absence are cacheable, an unreachable archive never is

## 3. Request page (web)

- [x] 3.1 Build the search page skeleton: SSR native-form baseline (no-JS submission still creates an acquisition through the existing action), minimal-plus-hint pre-search state with MBID teach, semantic-token-only styles
- [x] 3.2 Implement search-as-you-type: 600 ms debounce, Enter searches immediately, in-flight abort, spinner; search-failed state distinct from zero results
- [x] 3.3 Render mixed results in per-entity layouts (release-group art grid, artist disc row, compact recording rows) in the read's intent order, with entity filter tabs and the zero-results state (named query, entity-switch links, MBID escape hatch)
- [x] 3.4 Wire one-click Request on every result to the existing submit contract with default policies, confirming with the acquisition identifier; MBID paste renders the resolved entity as the sole result
- [x] 3.5 Build the detail drawer (bottom sheet under 640 px, CSS only): release-group view with tracklist-grouped editions, format filter chips, lazy tracklist peek, best-match row showing the pipeline's pick (or the selection-required message), quality-floor options, request with optional pinned edition; artist discography view; recording view
- [x] 3.6 Edition pinning rides the EXISTING submit contract with no schema change: unpinned submits the release group, a pinned edition submits that release as a `musicbrainz` album request
- [x] 3.7 Component test tiers for every page state (`*.ssr.test.ts` + `*.svelte.test.ts`): empty, loading, results per entity order, filtered-empty with switch, zero results, search failed, drawer states, no-JS baseline
- [x] 3.8 Retire the mode-select `AcquisitionForm` surface once parity scenarios pass; keep the reshaper serving the native fallback path

## 4. Integration, audit, gate

- [x] 4.1 Playwright specs for the spec's scenarios: type→results→one-click request; dig-in with pinned edition; pasted MBID; filter + zero-result switch
- [x] 4.2 Audit `test/e2e` and any UI-scraping parity specs for dependence on the old form's copy/flow before the merge checkpoint (e2e runs only on main)
- [x] 4.3 Define the catalog-search anatomy once in `base.css` plus new semantic tokens, then deliberately theme it in all three skins (forum, glass, terminal); verify no skin leaves it browser-default and the detail surface becomes a bottom sheet at phone width
- [x] 4.4 `pnpm check` green (format, lint, typecheck, build, all tiers, 100% coverage); update `openspec/specs` via archive flow when shipped

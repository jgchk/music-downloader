# Tasks — search-first request page

All production code test-first (red before green), per `docs/development/testing.md`.

## 1. Catalog-search core (downloader)

- [ ] 1.1 Record contract fixtures for the newly consumed MusicBrainz shapes: release-group/artist/recording entity search, release browse by release-group with media, release lookup with recordings (tracklist); extend the live recorder scripts and replay tests in `packages/downloader/test/contract`
- [ ] 1.2 Add zod response schemas for the new MB shapes in `adapters/musicbrainz/schemas.ts` (tolerant readers, consumed fields only)
- [ ] 1.3 Port the prototype's ranking as pure functions with table-driven tests: pair score (artist-credit token coverage, subtitle-noise penalty, secondary-type penalty, type bonus, MB-score tiebreak), artist ranking with matched-name-length tie-break, recording ranking ("paul simon graceland" fixture must rank Graceland/Paul Simon first)
- [ ] 1.4 Implement intent ordering (exact artist name → artists; best recording > best album-shaped RG + margin, Singles excluded from album evidence → recordings; else release groups) with the three canonical query fixtures as tests
- [ ] 1.5 Define the catalog-search port (search, resolve-by-id, browse artist, list editions, get tracklist) and implement the MusicBrainz adapter over the shared rate-limited, User-Agent-identified client with short-TTL query caching
- [ ] 1.6 Implement the best-match preview by reusing `releaseGroupEditionIds` on the browse result (head of its output, or the explicit no-automatic-pick outcome); test that preview and pipeline agree on shared fixtures
- [ ] 1.7 Expose the facade read verbs (`searchCatalog`, `browseArtist`, `listEditions`, `getTracklist`) with zod boundaries, modeled failures distinct from empty results, and wire them in composition

## 2. Cover art (downloader + web)

- [ ] 2.1 Record CAA contract fixtures (front cover hit, confirmed 404) and add the Cover Art Archive adapter with a cover-art port; upstream failure modeled separately from confirmed absence
- [ ] 2.2 Implement the web art endpoints (`/art/release-group/<mbid>`, `/art/release/<mbid>`) streaming through a size-capped cache; confirmed 404 cached as absence, transient failure never cached; tests for both cache states

## 3. Request page (web)

- [ ] 3.1 Build the search page skeleton: SSR native-form baseline (no-JS submission still creates an acquisition through the existing action), minimal-plus-hint pre-search state with MBID teach, semantic-token-only styles
- [ ] 3.2 Implement search-as-you-type: 600 ms debounce, Enter searches immediately, in-flight abort, spinner; search-failed state distinct from zero results
- [ ] 3.3 Render mixed results in per-entity layouts (release-group art grid, artist disc row, compact recording rows) in the read's intent order, with entity filter tabs and the zero-results state (named query, entity-switch links, MBID escape hatch)
- [ ] 3.4 Wire one-click Request on every result to the existing submit contract with default policies, confirming with the acquisition identifier; MBID paste renders the resolved entity as the sole result
- [ ] 3.5 Build the detail drawer (bottom sheet under 640 px, CSS only): release-group view with tracklist-grouped editions, format filter chips, lazy tracklist peek, best-match row showing the pipeline's pick (or the selection-required message), quality-floor options, request with optional pinned edition; artist discography view; recording view
- [ ] 3.6 Decide and implement edition pinning against the existing facade schema (additive only): initial submit carrying the release, or immediate `selectEdition` follow-up
- [ ] 3.7 Component test tiers for every page state (`*.ssr.test.ts` + `*.svelte.test.ts`): empty, loading, results per entity order, filtered-empty with switch, zero results, search failed, drawer states, no-JS baseline
- [ ] 3.8 Retire the mode-select `AcquisitionForm` surface once parity scenarios pass; keep the reshaper serving the native fallback path

## 4. Integration, audit, gate

- [ ] 4.1 Playwright specs for the spec's scenarios: type→results→one-click request; dig-in with pinned edition; pasted MBID; filter + zero-result switch
- [ ] 4.2 Audit `test/e2e` and any UI-scraping parity specs for dependence on the old form's copy/flow before the merge checkpoint (e2e runs only on main)
- [ ] 4.3 Verify all three skins render the new page without component changes (tokens only) and the drawer sheet works at phone width
- [ ] 4.4 `pnpm check` green (format, lint, typecheck, build, all tiers, 100% coverage); update `openspec/specs` via archive flow when shipped

# Search-first request page

## Why

Requesting a download today means picking a request mode (MusicBrainz release ID / release-group ID / artist-title descriptor) and typing into blind form fields — in practice the descriptor path is used almost every time, and the user never sees what the system resolved until after submission (sometimes stalling later on edition selection). A session of prototyping (2026-08-18, prototypes A–D against the live MusicBrainz + Cover Art Archive APIs) converged on a search-first flow that shows the actual releases — art, artist, year — before committing, folds edition choice into the request itself, and makes the common case one search and one click.

## What Changes

- The request page becomes a single search box with debounced search-as-you-type (Enter searches immediately) over MusicBrainz, showing mixed entity results — release groups (album-art grid), artists (disc row), recordings (compact rows) — with entity filter tabs and intent-based block ordering (an exact artist-name query leads with artists; a clearly-track-shaped query leads with tracks; albums lead otherwise).
- Every result carries a primary one-click **Request** action (request with defaults); clicking a result opens a detail drawer (bottom sheet on mobile) with editions grouped by tracklist, on-demand tracklist peek, a transparent "Best match" row showing the exact edition the system's existing picker would resolve to, format filter, and quality-policy options. Artist results drill into a discography.
- Search relevance is owned server-side: a BFF/facade search read fans out MusicBrainz entity searches and re-ranks (artist-field-aware token scoring, subtitle-noise penalty, secondary-type penalty), because raw MusicBrainz Lucene ordering ranks tribute albums above the real release for "artist album" queries.
- Cover art (Cover Art Archive) is fetched and proxied/cached by the server — the app's first artwork integration.
- Pasting a MusicBrainz ID into the same search box resolves it directly (release group, artist, or recording); the old mode-select form disappears as a separate surface, with the no-JS fallback remaining a native form.
- Pre-search empty state is minimal-plus-hint; zero-results names the query and offers entity-type switches and the MBID escape hatch (per `docs/research/search-first-empty-states.md`).

## Capabilities

### New Capabilities

- `catalog-search`: the downloader-owned search read used to formulate a request — mixed-entity MusicBrainz search (release groups, artists, recordings) with server-side re-ranking and intent ordering, artist discography browse, release-group edition listing grouped by tracklist, per-edition tracklist read, and best-match edition preview (the same selection policy the acquisition pipeline uses).
- `cover-art`: cover-art lookup for release groups and releases via Cover Art Archive, proxied and cached by the server, with modeled absence (a missing cover is an expected outcome, not an error).

### Modified Capabilities

- `web-ui-presentation`: adds a catalog-search surface anatomy requirement — the search field, filter control, per-entity result layouts, artwork frame, and detail surface (side panel / bottom sheet) are structural once and deliberately themed in every shipped skin, alongside the existing timeline and decision-surface anatomies.
- `web-ui`: the "Acquisition submission and cancellation" requirement changes from a mode-select form to the search-first flow — search-as-you-type with filters and intent ordering, one-click request with defaults, detail drawer with edition/quality selection at request time, MBID paste, and the researched empty/zero-result states. Progressive enhancement is preserved: without JavaScript the page degrades to a native form submission.

## Impact

- **`packages/downloader`**: new search port + MusicBrainz search adapter methods (seeded by the existing private `searchUrl` in `adapters/musicbrainz/metadata.ts`), new facade read verb(s); the edition picker (`mapping.ts` `releaseGroupEditionIds`) is additionally exposed as a preview. Contract-test fixtures recorded for each newly consumed endpoint shape (MB entity search, lookups, artist browse, tracklist).
- **`packages/web`**: the Cover Art Archive port/adapter and its cached artwork endpoint live here beside the existing Plex port — cover art carries no meaning for the downloader, so giving that context a port for it would put a picture in a bounded context with no business holding one. `routes/acquisitions/new` and `AcquisitionForm.svelte` are replaced by the search-first page — the app's first heavy-JS surface; must keep reading semantic tokens only so all three skins keep working, and keep a no-JS native-form fallback. SSR/browser/Playwright test tiers extended accordingly.
- **External dependencies**: MusicBrainz rate limits (~1 req/s/IP) and requires a proper User-Agent — server-side fan-out with short-TTL caching is mandatory, and tracklist peeks are lazy per-group lookups (avoid N+1 on search results). Cover Art Archive 404s are common — placeholder rendering is a first-class state.
- **Prototype reference**: `proto-d-hybrid.html` + `rank.js` (session scratchpad) demonstrate the full interaction model and the re-rank scoring to be ported server-side; `docs/research/search-first-empty-states.md` records the empty-state verdicts.
- **Out of scope / follow-ups**: a popularity signal for same-titled obscure releases (needs research — Lidarr-style metadata proxy or release-count heuristics), and a country/region preference for the best-match edition default (the current policy surfaces as e.g. a DE first pressing; making it configurable is a separate decision).

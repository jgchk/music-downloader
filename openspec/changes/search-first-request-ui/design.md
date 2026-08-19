# Design — search-first request page

## Context

See `proposal.md` for motivation. The current request page is a progressive-enhancement native form (`packages/web/src/lib/components/AcquisitionForm.svelte` + a SvelteKit default action) reshaping fields into the downloader facade's `submitAcquisition` contract. MusicBrainz search exists only as a private resolution step inside `MusicBrainzMetadata` (`adapters/musicbrainz/metadata.ts` — `searchUrl` is private); the edition picker is `releaseGroupEditionIds` in `adapters/musicbrainz/mapping.ts`; the facade has no read verb for search; the app has zero artwork handling and no `<img>` anywhere. The interaction model was fully validated against the live APIs in prototype D (`proto-d-hybrid.html` + `rank.js`, session scratchpad 2026-08-18) and the empty-state research is in `docs/research/search-first-empty-states.md`. Constraints that bind the design: the dependency rule and pure domain, errors as values, contract-test fixtures for every consumed third-party shape, semantic-token-only component CSS under three skins, 100% coverage, and MusicBrainz's ~1 req/s/IP courtesy limit with a mandatory identifying User-Agent.

## Goals / Non-Goals

**Goals:**

- One search read powering the whole page (mixed entities + intent ordering), with ranking logic as pure, unit-tested functions.
- Edition/tracklist/best-match reads shaped exactly for the drawer, with the best-match preview produced by the *same* code path the pipeline uses.
- A cover-art proxy that makes CAA's slowness and 404s invisible to the UX.
- The page itself as the app's first heavy-JS surface without abandoning the no-JS fallback or the skin system.

**Non-Goals:**

- Popularity-aware ranking of same-titled obscure releases (separate research follow-up; the token ranking here fixes the artist-field problem only).
- Changing the acquisition pipeline's edition-selection policy (e.g. country preference) — we expose it, we don't alter it.
- Search over anything but MusicBrainz (no local-library search, no source search).

## Decisions

1. **Search lives behind the facade as a read verb, not a web-only endpoint.** The downloader owns MusicBrainz vocabulary; the BFF stays presentation-only. A new port (e.g. `CatalogSearchPort`) with a MusicBrainz adapter, surfaced as facade reads (`searchCatalog`, `browseArtist`, `listEditions`, `getTracklist`). *Alternative rejected:* a SvelteKit-only server route calling MB directly — it would smuggle downloader vocabulary (release groups, editions, selection policy) into the BFF and duplicate the MB client, User-Agent policy, and contract tests.
2. **Ranking and intent ordering are pure domain-adjacent functions** ported from the prototype's `rank.js`: pair scoring (query-token coverage across title+artist credit, subtitle-noise penalty, secondary-type penalty, type bonus, MB score as tiebreak), artist tie-break by matched-name length, and block ordering (exact artist name → artists; best recording > best album-shaped RG + margin, with Singles excluded from album evidence → tracks; else albums). Pure functions over already-fetched data → trivially unit-testable, mutation-gate friendly. *Alternative rejected:* trusting MB's Lucene order (demonstrably wrong: "paul simon graceland") or MB's `dismax` (unvalidated, still single-entity).
3. **Best-match preview calls `releaseGroupEditionIds` itself.** The preview and the pipeline must never disagree, so the read maps its browse result into the same `ReleaseGroupEdition` inputs and takes the head of the same function's output; "no candidates" surfaces as the explicit no-automatic-pick outcome (mirroring `needsSelection`). *Alternative rejected:* re-implementing the policy in the read (drift) or in the browser (the prototype did this only as a stand-in).
4. **One search request from the browser; fan-out on the server.** The BFF/facade read performs the three MB entity searches (and caching) server-side. Debounce (~600 ms) + Enter-immediate + in-flight abort in the client; short-TTL (~1–5 min) in-memory cache keyed by query on the server; single shared MB client enforcing the User-Agent and a request-rate ceiling. Tracklists are a separate lazy read (avoid N+1). *Alternative rejected:* browser→MB direct (CORS works but violates stewardship, leaks vocabulary, and can't cache across household users).
5. **Cover art: server proxy endpoint with two-state caching.** `/art/release-group/<mbid>` (and `/art/release/<mbid>`) streams CAA's front-250/front-500, caching bytes on success and a confirmed-404 marker separately from transient failures (which are not cached). UI always renders an initials placeholder until an image loads; `onerror` falls back to it. *Alternative rejected:* hotlinking CAA from the browser (slow, 404-noisy, third-party requests from every client) or eagerly resolving art URLs inside search results (couples reads, serializes latency).
6. **The page is client-rendered search over a native-form skeleton.** The SSR baseline renders the search box inside a real `<form method="GET">` plus a minimal native submit path (artist/title fields inside a `<noscript>` or the same form posting to the existing action) satisfying the no-JS scenario; JS progressively upgrades to search-as-you-type, filters, drawer. Components read semantic tokens only; the drawer becomes a bottom sheet under ~640 px via CSS alone so skins keep working unchanged. *Alternative rejected:* keeping the old mode-select form as a parallel page (two request surfaces to maintain, and the audit in `e2e-blackbox-blast-radius` says scraping tiers break silently when copy/flows fork).
7. **Submit contract is reused, not extended (except edition pinning).** Quick request maps a release-group result to the existing `release-group` request kind (a recording to `descriptor`/track or `musicbrainz` as the contract already allows); pinning an edition in the drawer submits the concrete release the same way `selectEdition` records one today. Whether pinning rides the initial submit or an immediate follow-up `selectEdition` is decided at implementation against the existing facade schema — additive only, no breaking change to `submitAcquisitionRequestSchema`.

## Risks / Trade-offs

- [MB rate limiting under real typing] → server cache + single rate-limited client + debounce; the UI's search-failed state ("MusicBrainz didn't answer… retry") is a first-class scenario, verified in prototypes where live 503s occurred.
- [Token ranking is heuristic; some queries will still order oddly] → all scoring is pure and table-driven-testable; the popularity follow-up is explicitly out of scope and tracked in the proposal.
- [First heavy-JS surface strains the SSR/browser/Playwright test regime] → keep the search page's state in plain testable modules (ranking/order/grouping already pure); component tests cover rendering states (empty/loading/results/zero/failed) — the states are enumerated in the spec.
- [E2E and parity specs scrape the current form] → audit `test/e2e` and any UI-scraping tiers before the merge checkpoint (known blast-radius hazard).
- [CAA byte-caching grows unbounded] → small LRU or size-capped disk cache; art is re-fetchable, so eviction is safe.

## Open Questions

- Cache TTLs and cover-art cache sizing (tunable env config; defaults can be chosen at implementation).
- Whether artist thumbnails ever get real images (CAA has none; fanart.tv/Wikimedia would be a new dependency — placeholder discs are the deliberate v1 answer).

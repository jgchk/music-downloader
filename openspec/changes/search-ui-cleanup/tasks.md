# Tasks — search-first request page cleanup pass

All production code test-first (red before green), per `docs/development/testing.md`.
Prerequisite: `search-ui-anatomy-fix` merged (this change styles surfaces the chrome inversion
creates and extends its layout tests).

## 1. Catalog-search read (downloader)

- [x] 1.1 Artist `type` (red first): additive DTO field read tolerantly from the artist search
      response beside `disambiguation`; a recorded contract fixture proves the consumed field is
      present (extend the recorder if the current fixture lacks it); facade schema growth
      additive-only under the contract tier
- [x] 1.2 `pnpm check` in `packages/downloader`; recorded-fixture replay green

## 2. Wire semantics (web server)

- [x] 2.1 `statusOf` splits `InfraError` on its `permanent` flag (red first): 502 transient,
      500 permanent; existing consumers proven tolerant; the catalog route's logging unchanged
- [x] 2.2 Cover-art unavailability memo (red first): one archive-wide "unreachable until T" mark
      set by any transport failure and consulted by every lookup, TTL through the cache's config
      with a ~60s default, proven by the injected clock; never promoted to absence; absence and
      art lifetimes untouched
- [x] 2.3 `COVER_ART_BASE_URL` joins the environment schema with the archive default; the adapter
      is constructed from config like every other upstream

## 3. Top results and honest counts (web)

- [x] 3.1 Top-results trim as pure view logic (red first): constants (10 release groups /
      6 artists / 6 recordings) beside the ordering logic in `lib/search/view.ts`; the mixed view
      renders the slice, a kind's filter tab renders everything fetched
- [x] 3.2 Heading affordance (red first): a trimmed section's count renders link-styled as
      "shown of matched" and activating it applies that kind's filter; an untrimmed section shows
      its plain count

## 4. Detail view context (web)

- [x] 4.1 `DetailState` carries the opening result's display fields (red first): artist credit,
      year, type for release groups; artist credit + release title/identifier for recordings;
      the identifier-lookup path carries the same fields
- [x] 4.2 Release-group view (red first): subtitle line (artist · year · type, absent parts
      omitted) and the release-group identifier line
- [x] 4.3 Always-visible best-match summary (red first): names the pick's title, disambiguation,
      and distinguishing details — or the selection-required sentence — above the groups,
      visible under any group collapse and any format filter; the group containing the pick opens
      alongside the most-common group; activating the summary clears any chosen edition
- [x] 4.4 Format chips (red first): pure categorization (cd / vinyl / digital / other) in
      `lib/search`, filtering editions and regrouping with truthful counts, empty-in-this-format
      state named
- [x] 4.5 Track view (red first): release artwork slot, artist credit, and the "from <release>"
      line above the track request form
- [x] 4.6 The chosen-edition rename: `EditionPin`/`onPin`/`pin` and their copy become the
      chosen-edition family throughout `lib/search` and the components; no occurrence of the old
      word survives outside history

## 5. Artist discography view (web)

- [x] 5.1 Page-level browse state (red first): selecting an artist renders the discography
      through the release-group grid presentation — "Albums by <name>" heading, back crumb
      re-rendering the held results without a new search; typing exits the browse; a filter tab
      exits it and applies the filter; the `artist` arm leaves `DetailState`
- [x] 5.2 Discography entries behave like album results (red first): one-click Request and
      click-through to the standard release-group detail view, artwork via the cover-art endpoint
- [x] 5.3 Remove the panel discography rendering and its styles; SSR + browser tests updated for
      the takeover, crumb, and empty-discography state

## 6. Requesting stays on the page (web)

- [ ] 6.1 The named request action (red first): result-borne forms post to `?/request`, which
      answers modeled success (identifier + display title) instead of redirecting; the default
      action keeps the redirect for the no-JS fallback; rejected submissions unchanged
- [ ] 6.2 Per-form confirmation (red first): the status-register line naming the download and
      linking its identifier renders at the form that submitted; results, filters, and any open
      detail view survive; several requests leave several confirmations
- [ ] 6.3 Per-form busy state (red first): only the submitting form disables; sibling request
      actions stay live; double-submit still impossible per form

## 7. Dismissal and copy (web)

- [ ] 7.1 Non-modal dismissal (red first): page-level Escape closes the open detail view from
      anywhere; activating anything outside it closes it; no scrim; `aria-modal` stays false;
      focus returns to the originating result on close; the panel contains its own overscroll
- [ ] 7.2 Failure-copy mapping (red first): a 502 refusal from a catalog read renders the
      retry-guiding copy (naming the catalog; pause, or press Enter to retry); a 500 renders the
      that-is-a-bug register; 4xx modeled refusals keep the server's words;
      unreachable-vs-unreadable and the partial-degradation notice untouched
- [ ] 7.3 Copy and focus details (red first where a behavior is asserted): the pre-search hint
      regains a pasteable example identifier; the artist card subline falls back
      disambiguation → type → "Artist" (consuming 1.1); the search input autofocuses on arrival;
      a filter tab returns focus to the input

## 8. Blast radius, gate, and ship

- [ ] 8.1 Audit `test/e2e` and every UI-scraping tier BEFORE the merge checkpoint for the
      post-submit navigation change and the copy changes (known hazard: these tiers break outside
      the diff and the e2e gate runs only on main); scraped phrases go through the centralized
      phrase maps
- [ ] 8.2 Side-by-side re-verification against prototype D (`proto-d-hybrid.html`): artist
      browse, request-in-place, detail-view context, and dismissal re-exercised; the audit list
      closed out item by item
- [ ] 8.3 Full gate (`pnpm check`) green; 100% coverage without new waivers;
      `pnpm version:prep` minor bump (`feat`); one PR

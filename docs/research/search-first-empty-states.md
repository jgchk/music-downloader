# What should the empty states of a search-first "request a download" page be — the pre-search state and the zero-results state?

> Research notes, 2026-08-18 (all URLs accessed that day). Scope: the redesign of the
> "request a download" page in `packages/web` from a mode-select form into a search-first
> experience (one box; debounced search-as-you-type; a grid of MusicBrainz album-art results,
> mixed entity types). Two states need designing: **pre-search** (first paint, before any
> keystroke) and **zero results** (debounce fired, MusicBrainz returned nothing).
>
> This file extends [timeline-ux-best-practices.md](timeline-ux-best-practices.md) (whose §1
> microcopy register and §5 empty-state taxonomy are adopted house findings) and
> [review-surface-ux-best-practices.md](review-surface-ux-best-practices.md) (action-button
> microcopy §1, progressive disclosure §4). Points those files own are cited as
> `<file> §n`, not re-argued.
>
> **Question.** According to UX literature and mature search-first products, what belongs in
> (1) the pre-search state — minimal box vs system state vs discovery content vs a hybrid — and
> (2) the zero-results state — what it should say and offer? And does the answer change for a
> single-user/small-household, self-hosted, *intent-driven* tool versus a discovery/streaming
> product?
>
> **Method.** Primary sources fetched directly wherever possible: NN/g and Baymard articles;
> design-system documentation (Polaris, Atlassian, Apple HIG, Material — Carbon via the house
> doc); and the actual UI source code / i18n string files of the closest comparable products
> (Lidarr, Sonarr, Overseerr, VS Code) plus live zero-results pages (GitHub, MusicBrainz
> itself). Claims verified only through search excerpts or mirrors are marked **[secondary]**;
> unreachable sources are named as unreachable, never paraphrased from memory. Nothing here is
> normative for the codebase until adopted via an OpenSpec change.

---

## §1 — The pre-search state: what the literature says

### 1.1 The empty-state canon applies, in its "first-use/educational" variant

The house taxonomy (timeline-ux-best-practices.md §5) already adopts NN/g's three empty-state
jobs — communicate status, provide learning cues, offer direct pathways to action
([NN/g, Designing Empty States in Complex Applications](https://www.nngroup.com/articles/empty-state-interface-design/))
— and Carbon's split of empty-state *types* (first-use vs error-management). A pre-search
page is the **first-use/educational** type: nothing is wrong, so the state's whole job is
learning cues + a direct pathway. NN/g's specifics for empty containers: "Explain what content
could populate the area and how to add it" and "provide actionable links or buttons … users can
activate immediately" (same article). The search box *is* the direct pathway, so the canon is
satisfied by the box plus a one-line learning cue — nothing in the empty-state literature
demands more content than that.

Design-system content rules for that one line:

- Atlassian **[secondary — atlassian.design is JS-rendered; verified via search excerpts]**:
  an empty state "describes what the user can do next"; title "informative, scannable …
  sentence case"; description = "the reason for the empty state and where they can go next",
  1–2 sentences ([Atlassian, Writing guidelines — Empty state](https://atlassian.design/content/writing-guidelines/empty-state/)).
- Polaris: empty-state content is "action-oriented", one clear primary action, encouraging,
  simple language ([Polaris EmptyState, via the ownego Polaris-Vue mirror of the archived
  guidance](https://ownego.github.io/polaris-vue/components/EmptyState) **[secondary — the
  canonical polaris.shopify.com component page now redirects to shopify.dev]**).
- Primer Blankslate (house doc): primary text "welcoming, human, and convey[s] the intention
  of the feature" (timeline-ux-best-practices.md §5).

### 1.2 What may sit beside the box: recent activity is the endorsed filler, per Apple

The only *content class* the platform literature explicitly endorses for the before-typing
moment is **the user's own history**: "When you display a person's recent searches before they
start typing or offer predictive search suggestions while they're typing, you can help people
search faster and type less" — with the caveat to "take privacy into consideration" and
"provide a way for people to clear it"
([Apple HIG, Searching](https://developer.apple.com/design/human-interface-guidelines/searching),
via Apple's docs JSON endpoint). No surveyed literature source recommends filling a search
page's pre-search state with third-party promotional/discovery content; that pattern comes
from e-commerce and streaming products (§3), not from the guidance canon.

One tempering datum on how much weight suggestions of any kind can bear: in NN/g's testing,
search suggestions were "selected by users in only 23% of the instances where they were
offered" ([NN/g, Site Search Suggestions](https://www.nngroup.com/articles/site-search-suggestions/))
— useful, not load-bearing. And if heterogeneous content is shown around a search box, it must
be labeled: "Clearly label the enriched suggestion types (e.g., top sellers, recommended
products, recent searches) so that users do not have to guess what they're seeing or why it's
being displayed" ([NN/g, Enriched Site-Search Suggestions](https://www.nngroup.com/articles/enriched-site-search-suggestions/)).

### 1.3 What the intent-driven products actually render before the first keystroke

- **Lidarr** (the closest domain neighbor — self-hosted music requester, search-first add
  flow) renders a deliberately minimal educational empty state: the page is the search box
  plus the line **"It's easy to add a new artist, just start typing the name of the artist you
  want to add."**, with the ID escape hatch taught in the box's placeholder: **"eg. Breaking
  Benjamin, lidarr:854a1807-025b-42a8-ba8c-2a39717f1d25"**
  ([Lidarr source, AddNewItem.js](https://github.com/Lidarr/Lidarr/blob/develop/frontend/src/Search/AddNewItem.js);
  strings from [en.json](https://github.com/Lidarr/Lidarr/blob/develop/src/NzbDrone.Core/Localization/Core/en.json),
  keys `ItsEasyToAddANewArtistJustStartTypingTheNameOfTheArtistYouWantToAdd`,
  `SearchBoxPlaceHolder`). No system state, no discovery content.
- **Sonarr** is structurally identical: pre-search shows `AddNewSeriesHelpText` ("It's easy to
  add a new series, just start typing the name the series you want to add.") plus a
  `SearchByTvdbId` hint ([Sonarr source, AddNewSeries.js](https://github.com/Sonarr/Sonarr/blob/develop/frontend/src/AddSeries/AddNewSeries/AddNewSeries.js);
  [en.json](https://github.com/Sonarr/Sonarr/blob/develop/src/NzbDrone.Core/Localization/Core/en.json)).
- **Overseerr/Jellyseerr** (nearest problem shape: request-focused media search) puts the
  search box in the persistent header ("Search Movies & TV") and makes the *landing page* a
  Discover feed whose sections are third-party discovery **mixed with system state**:
  "Trending", "Popular Movies", "Upcoming Movies" — but also **"Recent Requests"** and
  **"Recently Added"** ([Overseerr source, i18n en.json](https://github.com/sct/overseerr/blob/develop/src/i18n/locale/en.json),
  keys `components.Discover.*`, `components.Layout.SearchInput.searchPlaceholder`). So the one
  requester-shaped product that *does* fill its pre-search surface fills it half with the
  system's own request state — and Overseerr is explicitly a multi-user *discovery* product
  ("media discovery tool", [seerr.dev](https://seerr.dev/)).
- **Command palettes** — the purest intent-driven search-first surfaces — fill the empty-input
  state with **recency/frecency, never discovery**. VS Code's command palette groups results
  under separators localized as **"recently used"**, **"commonly used"**, and "other
  commands", with the recently-used section shown first including when the input is empty
  ([VS Code source, commandsQuickAccess.ts](https://github.com/microsoft/vscode/blob/main/src/vs/platform/quickinput/browser/commandsQuickAccess.ts)).
  Raycast's root search "suggests your recently and frequently used commands and apps" before
  typing, with user-pinned favorites "at the top of the root search"
  ([Raycast changelog v0.31.0](https://www.raycast.com/changelog/macos/0-31-0)); ranking is
  frecency-based ([Raycast API, useFrecencySorting](https://developers.raycast.com/utilities/react-hooks/usefrecencysorting)).
- **Spotify's search tab** (the discovery-class comparator): before typing it shows **recent
  searches** plus a "Browse all" category grid **[secondary — Spotify's support article on
  search documents only post-query behavior; the pre-search anatomy is verified via Spotify
  community-staff FAQ excerpts and product observation]**
  ([Spotify support, Search](https://support.spotify.com/us/article/search/);
  [Spotify community FAQ excerpts](https://community.spotify.com/t5/FAQs/Search-sort-and-filter-in-Spotify/ta-p/4649789),
  page itself returned HTTP 403).
- **GitHub search and MusicBrainz's own search** offer no pre-search content at all beyond
  the input (product observation of the fetched pages, 2026-08-18).

**Convergence:** across five independent intent-driven tools (Lidarr, Sonarr, VS Code,
Raycast, GitHub), *none* fills the pre-search state with third-party discovery content. The
fillers observed are exactly two: a one-line educational hint (+ ID escape hatch) and the
user's own recent/frequent activity.

---

## §2 — The zero-results state

### 2.1 The literature is near-unanimous on the shape

NN/g's dedicated no-results guidance gives three rules ([NN/g, 3 Guidelines for Search Engine
"No Results" Pages](https://www.nngroup.com/articles/search-no-results-serp/)):

1. **"Clearly explain that there are no matching results"** — typographically prominent,
   never buried, restating the original query.
2. **Offer a path forward**, concretely: "a search box (with the original query still in it
   for easy editing)", "suggestions for similar queries that do return results", "spelling
   corrections", "advice about how to modify queries, using different words or fewer words".
3. **Avoid mocking users**: "Exercise extreme caution when trying to use humor on No Results
   pages" — a frustrated user reads humor as ridicule. (The house register already bans
   "oops"-class interjections: timeline-ux-best-practices.md §1.2.)

Baymard sharpens rule 2 with the key finding that **"search tips alone fall short"** — users
rarely apply generic advice; concrete, clickable alternatives work. Its no-results strategies:
feature related categories; suggest alternative queries *with previewed results* ("Display a
preview of the top 3–5 products for each alternate query", auto-applying the alternative when
only one exists, with notice); personalized recommendations; support contact; popular items
([Baymard, 5 Proven UX Strategies for "No Results" Pages](https://baymard.com/blog/no-results-page)).
Baymard's benchmark finds 68% of e-commerce sites ship a no-results page that is "essentially
a dead-end … no more than a generic set of search tips"
([Baymard, on-site search research](https://baymard.com/blog/no-results-page)). The last three
strategies are e-commerce merchandising moves (§3); the first two translate directly to entity
types and query permutations.

Polaris's `EmptySearchResult` best practices state the copy rule precisely: **reference the
query directly** — do: "No orders found tagged with 'X'"; don't: "No results found" — and
**offer concrete actions** — do: "Clear search query", "Clear filters"; don't: "Try changing
the search term" ([Shopify/polaris-react issue #6144, quoting the component's documented best
practices](https://github.com/Shopify/polaris-react/issues/6144)).

NN/g's empty-state article adds the status obligation that separates *no matches* from *broken
or still loading*: say why it's empty, and never show "misleading messages that later get
replaced with actual content, which damages user trust"
([NN/g, Designing Empty States](https://www.nngroup.com/articles/empty-state-interface-design/))
— for a debounced search-as-you-type surface this means the zero-results render must never
appear while a request is still in flight, and a search *failure* is a different state with
error-management copy (house taxonomy, timeline-ux-best-practices.md §5).

### 2.2 What the products say at zero results

| Product | Zero-results copy | Recovery offered |
| --- | --- | --- |
| Lidarr | "Couldn't find any results for '{0}'" | Repeats the MusicBrainz-ID search hint ("You can also search using the MusicBrainz ID of an artist or release group e.g. lidarr:…") ([source](https://github.com/Lidarr/Lidarr/blob/develop/frontend/src/Search/AddNewItem.js)) |
| Sonarr | "Couldn't find any results for '{term}'" | Repeats `SearchByTvdbId` + a "Why can't I find my show?" FAQ link ([source](https://github.com/Sonarr/Sonarr/blob/develop/frontend/src/AddSeries/AddNewSeries/AddNewSeries.js)) |
| GitHub | "Your search did not match any repositories" | Advanced-search link ([live page, fetched 2026-08-18](https://github.com/search?q=zxqvjkwertnotreal&type=repositories)) |
| MusicBrainz (our data source's own UI) | "No results found. Try refining your search query." | Link to search-syntax docs ([live page, fetched 2026-08-18](https://musicbrainz.org/search?query=zzqxjwkvnotarealalbum&type=release_group)) |
| Overseerr | "No results." — bare, centered, gray | Nothing ([ListView source](https://github.com/sct/overseerr/blob/develop/src/components/Common/ListView/index.tsx); [en.json](https://github.com/sct/overseerr/blob/develop/src/i18n/locale/en.json)) |

The *arr pattern is the strongest precedent for this app: the zero-results state names the
query **and re-teaches the ID escape hatch** — the exact "paste-an-MBID" affordance on our
table — in both the pre-search and zero-results states. Overseerr's bare "No results." is the
dead-end Baymard's 68% statistic indicts. GitLab's design backlog for its own global search
independently converges on the same recovery set: draw attention to active scopes/filters,
make expanding scope or clearing filters easy, "Did you mean…" corrections, and docs links
([gitlab-org/gitlab#342183](https://gitlab.com/gitlab-org/gitlab/-/issues/342183)).

### 2.3 Entity-type hints are the scoped-search finding in disguise

"No albums — 3 artists matched" is a *scope* problem: NN/g's scoped-search guidance says users
must always know a scope is active, the default path should be unscoped, and scope indicators
must be visually distinct from the query
([NN/g, Scoped Search: Dangerous, but Sometimes Useful](https://www.nngroup.com/articles/scoped-search/)).
Combined with NN/g's "suggestions for similar queries that do return results" and Baymard's
previewed-alternatives strategy, the translation is direct: when an entity-type filter (or the
release-group-first default) hides matches that exist under another type, the zero-results
state should say so and offer the one-click switch — a *computed, clickable* alternative, not
a tip. This app can compute it cheaply: the same debounced MusicBrainz round-trip can carry
counts for the other entity types.

On spelling: MusicBrainz's search endpoint does not return "did you mean" corrections (its own
UI offers none — see table above), so promising spell-correction the system cannot compute
would violate the house truthfulness rule (web-ui spec: consequence copy "states the composed
system's actual contract"). Spelling stays as *advice*, not as a computed suggestion.

---

## §3 — Intent-driven vs discovery products: the axis of divergence

The literature and product survey split cleanly, and the axis is **whose interest fills the
idle surface**:

- **Discovery/merchandising products** (e-commerce per Baymard, Spotify, Overseerr's Discover
  feed) fill pre-search and no-results space with browse categories, trending, popular, and
  personalized recommendations — because for them an empty query or failed search is a selling
  opportunity, and "shift[ing] the experience from 'failure' to discovery" is a business
  outcome ([Baymard](https://baymard.com/blog/no-results-page)). Spotify's pre-search browse
  grid and Overseerr's Trending/Popular sections are this class.
- **Intent-driven tools** (VS Code, Raycast, Lidarr/Sonarr, GitHub, MusicBrainz) never do
  this. Their pre-search states are either near-empty with an educational hint, or filled with
  the *user's own* recent/frequent activity; their zero-results states are a plain statement
  plus tool-specific escape hatches (ID search, advanced search, syntax docs).

This app is unambiguously in the second class: single-user/small-household, the user arrives
already knowing what they want to request. That kills option (c) (discovery content pulled
from MusicBrainz or elsewhere) on three independent grounds: no product in the app's class
does it; it would add a new outbound dependency/latency for content the user didn't ask for;
and the recommendation literature that supports it is explicitly merchandising-motivated.

It does **not** kill system state (option b) — recent requests are the app's analog of the
"recently used" section every command palette ships, and Overseerr's landing page showing
"Recent Requests" is the closest-shape precedent. But two house facts weigh against making it
big: the acquisitions list already exists as its own surface (duplication), and pending
decisions are already surfaced globally by the attention-queue nav badge (web-ui spec,
"Pending attention is discoverable from the navigation"). The command-palette analogy is also
imperfect: a palette is the app's *front door*, whereas this page is reached deliberately from
navigation by a user holding a query — the moment Apple optimizes for ("search faster and type
less") is mostly about re-finding, which matters less when every successful request removes
the reason to search for it again.

---

## §4 — Verdict (input to a decision, not normative until an OpenSpec change adopts it)

### 4.1 Pre-search state — ranked

1. **Minimal-plus-hint (option a, sharpened by the *arr precedent).** The search box as the
   page's single focal point, autofocused, with (i) a placeholder that teaches by example —
   including the MBID form, exactly as Lidarr's placeholder does — and (ii) one register-
   compliant supporting line naming the pathway and the escape hatch. Nothing else above the
   fold. Grounds: the empty-state canon requires only learning cue + direct pathway (§1.1);
   every surveyed intent-driven neighbor ships exactly this (§1.3); and it is the cheapest
   state to keep correct on the app's first heavy-JS surface, where the pre-search render is
   also the no-JS fallback and must remain a working native form (web-ui spec's progressive-
   enhancement posture — the box must submit server-side without a keystroke listener).
2. **…plus a compact recent-requests strip (option b-lite) — adopt only with a reason.** If
   the request page is expected to become the household's habitual landing page, a small,
   clearly labeled "Recent requests" section (3–5 rows, phase badge, link to the acquisitions
   page; labeled per NN/g's enriched-suggestions rule, §1.2) is the pattern with the best
   precedent (VS Code/Raycast recency, Overseerr's Recent Requests, Apple HIG's endorsement of
   history). It must be a *link farm into the existing acquisitions surface*, never a second
   rendering of its detail — otherwise it duplicates a surface the app already owns. Rank it
   second because the duplication cost is real and the nav already badges pending attention;
   nothing in the survey says a *dedicated* request page (vs an app front door) needs it.
3. **Rejected: discovery content (option c)** — no precedent in the app's product class, new
   outbound dependency, merchandising-motivated literature only (§3). Also rejected: a large
   hybrid dashboard (option d beyond b-lite) — it turns the request page into a second home
   page and buries the one action the user came for under content that belongs to other
   surfaces.

**Copy suggestions (house register: sentence case, no "we", verb-led, real-world nouns
allowed — timeline-ux-best-practices.md §7.1):**

- Placeholder: `Search for an album, artist, or song…`
  (or the *arr-style teaching form: `e.g. Rumours, Fleetwood Mac, or a MusicBrainz ID`)
- Supporting line: `Type to search MusicBrainz — or paste a MusicBrainz ID to request an
  exact release`
- Recent-requests strip heading, if adopted: `Recent requests` with a `View all requests`
  link — never an architecture noun, never unlabeled content (NN/g §1.2).

### 4.2 Zero-results state — ranked composition

The shape is settled by near-unanimous convergence (NN/g, Baymard, Polaris, Atlassian, Carbon
via the house taxonomy, plus Lidarr/Sonarr/GitHub in-product — seven independent sources):
**state it plainly naming the query, keep the query in the box, and offer concrete actions
rather than generic tips.** Ranked composition for this app:

1. **The statement, referencing the query** (Polaris do/don't, NN/g rule 1):
   `No matches for "{query}"` as the state's title. The query stays in the box for editing
   (NN/g rule 2).
2. **Entity-type hint with one-click switch, whenever computable** (the strongest concrete
   action this app can offer — §2.3): when the active type filter (or release-group-first
   presentation) hides matches of other types, say so and link the switch:
   `No albums matched — 3 artists did` + action `Show artists`. This is Baymard's
   previewed-alternative and NN/g's "similar queries that do return results" in one move, and
   it directly satisfies the Polaris "Clear filters"-class action rule.
3. **The MBID escape hatch, re-taught here** (*arr precedent in both Lidarr and Sonarr):
   `Know the exact release? Paste its MusicBrainz ID` — same affordance as the pre-search
   hint, repeated at the moment of failure.
4. **Query-modification advice, last and short** (NN/g allows it; Baymard demotes it):
   one line — `Check the spelling, or try fewer words`. No promised spell-correction: the
   backend cannot compute one (§2.3), and the house truthfulness rule forbids implying it.
5. **Never**: humor, mascots, or a bare "No results." (NN/g rule 3; Overseerr as the
   anti-pattern; the house register's no-interjections rule already covers this).

The **search-failed** state (MusicBrainz unreachable, request errored) is a different state
from zero results — error-management, not first-use (house taxonomy §5) — with its own copy:
`Search isn't available right now — try again in a moment`, plus the request page's native
submit path still working. Never render zero-results copy for a failed request.

### 4.3 Pitfall checklist

- **Zero-results shown while a request is in flight.** Debounce + latency means a naive
  render shows "no matches" then replaces it with results — NN/g's trust-damaging "misleading
  message". Gate the zero state on a *settled* response for the *current* input.
- **Zero-results shown for sub-threshold input.** Below the minimum query length, stay in the
  pre-search state, not the zero state.
- **Conflating no-matches with search-failed.** Three distinct renders: pre-search, zero
  results, error (plus loading). Each says which it is (NN/g empty-state guideline 1).
- **Generic tips as the only recovery.** Baymard's 68% dead-end finding; every tip should be
  outranked by a computable action (type switch, MBID entry).
- **Clearing the user's query on state change.** The original query stays in the box (NN/g).
- **Unlabeled content around the box.** Any recent-requests strip or suggestion group carries
  a label naming what it is (NN/g enriched-suggestions rule).
- **Suggestion overload.** If suggestion rows are ever added under the box, cap well under 10
  ([Baymard, autocomplete best practices](https://baymard.com/blog/autocomplete-design)); full
  keyboard support (arrows + enter) is expected table stakes (same source).
- **A pre-search state that needs JS to exist.** First paint is the no-JS state on this
  progressive-enhancement-first app: the form must submit natively; the debounced grid is an
  enhancement layered on top (web-ui spec).
- **Recent-searches history, if ever added, without a clear affordance** (Apple HIG privacy
  caveat) — low stakes in a household app, but the rule is cheap to honor.
- **Humor/apology theater in failure copy** — banned twice over (NN/g no-results rule 3;
  house register, timeline-ux-best-practices.md §1.2).

### 4.4 Honest coverage notes

- Spotify's pre-search anatomy and Atlassian's empty-state guidance rest on **[secondary]**
  excerpt-level verification (JS-rendered or 403-blocked pages, marked inline).
- Morville & Callender's *Search Patterns* could not be verified at page level; it is not
  cited for any claim. PyPI's search page was unreachable behind a challenge page; the
  package-registry class is represented only by GitHub. Linear's and Slack's command paletttes
  and app-store search were not examined first-hand; the command-palette class rests on
  VS Code (source code) and Raycast (vendor changelog/manual), which agree with each other.
- The canonical Polaris empty-state page has been folded into shopify.dev and no longer
  serves the old guidance; the Polaris claims here rest on the maintainers' own issue text
  and a faithful mirror, both marked.

---

## Sources

**Primary (fetched directly, 2026-08-18):**

- NN/g — [3 Guidelines for Search Engine "No Results" Pages](https://www.nngroup.com/articles/search-no-results-serp/) · [Designing Empty States in Complex Applications](https://www.nngroup.com/articles/empty-state-interface-design/) · [Site Search Suggestions](https://www.nngroup.com/articles/site-search-suggestions/) · [Enriched Site-Search Suggestions](https://www.nngroup.com/articles/enriched-site-search-suggestions/) · [Scoped Search: Dangerous, but Sometimes Useful](https://www.nngroup.com/articles/scoped-search/)
- Baymard — [5 Proven UX Strategies for "No Results" Pages](https://baymard.com/blog/no-results-page) · [9 UX Best Practice Design Patterns for Autocomplete Suggestions](https://baymard.com/blog/autocomplete-design)
- [Apple HIG — Searching](https://developer.apple.com/design/human-interface-guidelines/searching) (via Apple's docs JSON endpoint)
- Lidarr source — [AddNewItem.js](https://github.com/Lidarr/Lidarr/blob/develop/frontend/src/Search/AddNewItem.js) · [en.json](https://github.com/Lidarr/Lidarr/blob/develop/src/NzbDrone.Core/Localization/Core/en.json) (raw files)
- Sonarr source — [AddNewSeries.js](https://github.com/Sonarr/Sonarr/blob/develop/frontend/src/AddSeries/AddNewSeries/AddNewSeries.js) · [en.json](https://github.com/Sonarr/Sonarr/blob/develop/src/NzbDrone.Core/Localization/Core/en.json) (raw files)
- Overseerr source — [Search/index.tsx](https://github.com/sct/overseerr/blob/develop/src/components/Search/index.tsx) · [Common/ListView/index.tsx](https://github.com/sct/overseerr/blob/develop/src/components/Common/ListView/index.tsx) · [i18n en.json](https://github.com/sct/overseerr/blob/develop/src/i18n/locale/en.json) (raw files) · [seerr.dev](https://seerr.dev/)
- VS Code source — [commandsQuickAccess.ts](https://github.com/microsoft/vscode/blob/main/src/vs/platform/quickinput/browser/commandsQuickAccess.ts) (raw file)
- Raycast — [changelog v0.31.0 (Favorites)](https://www.raycast.com/changelog/macos/0-31-0) · [API: useFrecencySorting](https://developers.raycast.com/utilities/react-hooks/usefrecencysorting)
- [Shopify/polaris-react issue #6144 — EmptySearchResult documented best practices](https://github.com/Shopify/polaris-react/issues/6144)
- [GitLab design issue #342183 — global search empty and no-result states](https://gitlab.com/gitlab-org/gitlab/-/issues/342183)
- Live zero-results pages — [GitHub repository search](https://github.com/search?q=zxqvjkwertnotreal&type=repositories) · [MusicBrainz release-group search](https://musicbrainz.org/search?query=zzqxjwkvnotarealalbum&type=release_group)
- [Spotify support — Search](https://support.spotify.com/us/article/search/) (documents post-query behavior only)

**Secondary (marked inline where used):**

- [Atlassian Design System — Writing guidelines: Empty state](https://atlassian.design/content/writing-guidelines/empty-state/) (JS-rendered; verified via search excerpts)
- Polaris EmptyState guidance via the [ownego Polaris-Vue mirror](https://ownego.github.io/polaris-vue/components/EmptyState) (canonical page redirects to shopify.dev)
- Spotify pre-search anatomy — [Spotify community FAQ, Search/sort/filter](https://community.spotify.com/t5/FAQs/Search-sort-and-filter-in-Spotify/ta-p/4649789) (HTTP 403; excerpt-level) + product observation
- [Material 3 — Search guidelines](https://m3.material.io/components/search/guidelines) (JS-rendered; suggestion-chips behavior via search excerpts; not load-bearing here)

**Unreachable / not cited for claims:** Morville & Callender, *Search Patterns* (no page-level
excerpt verifiable); PyPI search (challenge page); polaris.shopify.com empty-state component
page (301 to shopify.dev).

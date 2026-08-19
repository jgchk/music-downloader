# web-ui Specification

## Purpose

Define the SvelteKit BFF web interface — the product's sole interface at functional parity with the retired MCP tools — including its in-process facade access rule, the single-process daemon shape, and the testing/coverage regime that keeps the UI package inside the 100% merged coverage gate.
## Requirements
### Requirement: Download submission and cancellation

The web UI SHALL let a user submit a download (target plus quality policy, matching the downloader facade's submit contract) and cancel a pending download. The request page SHALL be search-first: a single search box whose results — found via the catalog-search capability — are the things the user requests, replacing mode selection and hand-typed identifiers as the primary flow. Failures returned by the facade SHALL render as actionable messages, not crashes.

Search SHALL run as the user types, debounced, and immediately on Enter, with the search box focused on arrival. Results SHALL present release groups, artists, and recordings in visually distinct layouts (artwork grid, artist row, compact track rows), ordered by the catalog-search read's intent ordering, with tabs to filter to a single entity type. The mixed view SHALL present each kind's top results — the leading slice of its ranking, sized for a person scanning — while a kind's filter tab presents all of that kind's results; a trimmed section's heading SHALL state the trim ("10 of 25") as a one-interaction way to that kind's full results. Every requestable result SHALL carry an always-visible primary request action that submits with default policies in one interaction; affordances SHALL NOT be hover-revealed, and the page SHALL remain usable at narrow viewport widths.

Selecting a release group or recording SHALL open a detail view where the user can dig in before requesting. The detail view SHALL name what it presents beyond the bare title: for a release group, its artist credit, year, and type where the catalog states them, and its MusicBrainz identifier; for a recording, its artist credit, the release it appears on, and that release's artwork. A release group's detail view SHALL present its editions grouped by tracklist with an on-demand tracklist view, a format filter that narrows the editions and regroups what remains, quality-policy options, and an always-visible best-match summary stating the pipeline's pick and its distinguishing details — or that no automatic pick exists — visible regardless of which edition groups are expanded and regardless of the format filter, with the group containing the pick opened. The user MAY designate a chosen edition, making the request target that exact pressing; the best-match summary is itself the control for letting the system choose, clearing any chosen edition.

The detail view SHALL behave as the non-modal panel it is: the page behind it stays interactive and unobscured, Escape closes it from anywhere on the page, activating anything outside it closes it, a visible close control is always present, and on close focus returns to the result it was opened from.

Selecting an artist SHALL open the artist discography view: the results area presents that artist's release groups in the same artwork-grid presentation search results use, headed by the artist's name, with a one-interaction way back to the held search results that does not repeat the search. Typing a new query leaves the discography view, and activating an entity filter tab returns to the held results with that filter applied. Each discography entry SHALL carry the primary request action and SHALL open the standard release-group detail view.

Pasting a MusicBrainz identifier into the search box SHALL resolve it directly to its entity, presented with the same display fields a searched result carries.

A request submitted from a search result, a discography entry, or the detail view SHALL confirm on the request page itself — at the form that submitted it, naming the new download's identifier with a way to open it — leaving the query, its results, and any in-progress browsing intact, so several downloads can be requested from one search. While a request is in flight, only the form that submitted it SHALL be busy; other results' request actions stay live. The no-JS fallback form keeps its full-page round trip.

Before the first keystroke the page SHALL show only the search box plus a short hint teaching search-as-you-type and the identifier paste path, including a pasteable example identifier. A search with no matches SHALL name the query, offer a one-interaction switch to entity types that did match when the user has filtered, and restate the identifier escape hatch; a failed search SHALL be presented as a failure, never as "no matches" — a failure that may pass (the catalog could not be reached) SHALL name the catalog and the retry path, while one that will not (the catalog's answer could not be read) SHALL be worded as this application's fault, not the user's or the network's. Without JavaScript the page SHALL degrade to a native form submission that can still create a download, including by artist and title alone and including the request policies the submit contract accepts.

#### Scenario: Search-as-you-type with instant Enter

- **WHEN** a user types at least two characters and pauses, or presses Enter at any point
- **THEN** results for the current query render (debounced on typing, immediately on Enter), grouped by entity type in the catalog-search read's intent order

#### Scenario: The mixed view shows top results with an honest count

- **WHEN** a search matches more results of a kind than the mixed view presents
- **THEN** the mixed view lists that kind's top results, its heading states the trim as "shown of matched", and activating the stated count presents all of that kind's results

#### Scenario: A kind's tab shows everything

- **WHEN** a user filters to one entity kind
- **THEN** every fetched result of that kind renders, not only the mixed view's slice

#### Scenario: Successful submission

- **WHEN** a user submits a valid download form
- **THEN** the BFF dispatches the downloader facade's submit command in-process and the UI shows the new download with its identifier and current phase

#### Scenario: One-click request with defaults

- **WHEN** a user activates a result's primary request action
- **THEN** the BFF dispatches the downloader facade's submit command in-process with default policies and the UI confirms the new download with its identifier

#### Scenario: Requesting keeps the search

- **WHEN** a user requests a download from a search result and the submission succeeds
- **THEN** the confirmation renders at the form that submitted it, naming the new download's identifier with a way to open it, and the query, its results, and any open detail view remain as they were

#### Scenario: Only the submitted form goes busy

- **WHEN** a request from one result is in flight
- **THEN** that form alone is disabled against a second submission while the other results' request actions remain usable

#### Scenario: Dig-in request with a pinned edition

- **WHEN** a user opens a release group's detail view, designates a chosen edition from its tracklist-grouped editions, and requests
- **THEN** the submit command carries that edition choice and the UI confirms the new download

#### Scenario: The default edition is visible before requesting

- **WHEN** a user opens a release group's detail view
- **THEN** the pipeline's pick is presented as an always-visible summary stating its distinguishing details — even when the edition group containing it is collapsed and under any format filter — or the view states that no automatic pick exists and selection is required; activating the summary clears any chosen edition, letting the system choose

#### Scenario: The detail view names its subject

- **WHEN** a user opens a release group's detail view
- **THEN** it presents the artist credit, year, and type the catalog states, and the release group's MusicBrainz identifier

#### Scenario: Editions filter by format

- **WHEN** a user narrows the detail view's editions to one format category
- **THEN** only editions of that category present, regrouped with truthful group counts, the best-match summary stays visible, and clearing the filter restores the full grouped listing

#### Scenario: A track's detail view carries its context

- **WHEN** a user opens a recording's detail view
- **THEN** it presents the recording's artist credit, the release it appears on, and that release's artwork slot, alongside the track request

#### Scenario: The artist discography view takes over in place

- **WHEN** a user selects an artist result
- **THEN** the results area presents that artist's discography as the artwork grid, headed by the artist's name, and a single interaction returns to the held search results without re-searching

#### Scenario: A discography entry digs in like any album

- **WHEN** a user opens a release group from the artist discography view
- **THEN** the standard release-group detail view opens with its editions, best-match summary, and request actions

#### Scenario: Leaving the discography view

- **WHEN** a user types a new query, or activates an entity filter tab, while the artist discography view is open
- **THEN** typing searches anew, and the tab returns to the held results with that filter applied — neither leaves a stale discography on screen

#### Scenario: The detail view dismisses like a panel, not a modal

- **WHEN** a detail view is open and the user presses Escape with focus anywhere on the page, or activates anything outside the view
- **THEN** the view closes, focus returns to the result it was opened from, and the results are as they were

#### Scenario: Entity filter and zero-result recovery

- **WHEN** a user filters to one entity type and the query matches none of that type but does match others
- **THEN** the page names the query, states which entity types matched, and offers a one-interaction switch to them

#### Scenario: Pasted identifier goes straight to the entity

- **WHEN** a user pastes a MusicBrainz identifier into the search box
- **THEN** the matching entity renders as the sole result, ready to request

#### Scenario: Pre-search state is minimal

- **WHEN** a user opens the request page before typing
- **THEN** the page shows the search box and a short hint (including the identifier paste path with a pasteable example identifier) and nothing else

#### Scenario: Search failure is not "no matches"

- **WHEN** the catalog-search read returns a modeled failure
- **THEN** the page presents a failure message distinct from the zero-results state

#### Scenario: An unreachable catalog names the retry path

- **WHEN** a search fails because the catalog could not be reached
- **THEN** the message names the catalog and advises the retry (pause, or press Enter to try again)

#### Scenario: A drifted catalog is not blamed on the user

- **WHEN** a search fails because the catalog's answer could not be read
- **THEN** the message states this application went wrong — never advice to check the connection or retype the query

#### Scenario: Rejected submission renders the modeled error

- **WHEN** the facade returns a modeled validation or conflict error for a submission
- **THEN** the UI surfaces the failure's message and no download is created

#### Scenario: No-JS fallback still submits

- **WHEN** a user without JavaScript opens the request page
- **THEN** a native form submission can still create a download through the same facade contract

#### Scenario: Cancellation

- **WHEN** a user cancels a download that is still cancellable
- **THEN** the facade's cancel command is dispatched and the UI reflects the cancelled state

### Requirement: Download progress observation

The web UI SHALL show the user each download's current phase and outcome (including failure reasons) from the downloader facade's read models.

The downloads view SHALL present the downloads as a compact master list — each download rendering its target description and a phase signal (its in-progress phase, or its terminal done/failed state) — beside a detail pane that shows the selected download in full. Each download's outcome (its deposited location, or its failure reason) SHALL be surfaced in the detail view for the selected download, NOT as an inline column of the master list, so the master stays scannable and one long value (a file path or a multi-clause reason) cannot distort it.

Status SHALL be presented in human phrases, never as raw status enum identifiers (for example `MetadataFailed` or `Conflicted`); counts SHALL be pluralized correctly and zero-count segments omitted. The detail header SHALL label the library location when one exists and SHALL NOT repeat the failure account that the timeline's terminal entry already gives.

Failure reasons SHALL be surfaced through already-visible outcome text — the outcome summary and the timeline on the detail view — and SHALL NOT be duplicated behind a control that reveals the same human-readable reasons. Per-entry disclosure elements SHALL reveal only diagnostic payload (raw codes, paths, raw scores) distinct from the visible human-readable account. The phase badge SHALL be a status indicator only and SHALL NOT carry a reason-revealing disclosure. No disclosure affordance SHALL be presented where there is no payload to show, so that the user is never offered a control that leads to an empty result.

#### Scenario: Progress listing

- **WHEN** a user opens the downloads view while downloads exist in various phases
- **THEN** each download renders in the master list with its target description and a human-phrase phase signal, with correctly pluralized counts and no raw enum identifiers

#### Scenario: Outcome is shown in the detail view on selection

- **WHEN** a user selects a download
- **THEN** the detail view shows that download's outcome — a labeled library location for a fulfilled download, or the timeline's plain-words terminal account for a failed one — in human phrases

#### Scenario: Human reasons visible once, diagnostics behind disclosure

- **WHEN** a user views a failed download whose history carries failure reasons
- **THEN** the human-readable reasons appear in visible text exactly once, any raw diagnostic payload sits behind per-entry disclosure, and the phase badge presents no reveal control

#### Scenario: No disclosure control when there is nothing to reveal

- **WHEN** a user views a timeline entry or download that carries no diagnostic payload
- **THEN** no disclosure affordance is presented, rather than a control that expands to an empty result

### Requirement: Import review resolution

The web UI SHALL let the user resolve a pending import review (matching the importer facade's resolve contract), at parity with the retired `resolve_review` MCP tool. Pending reviews SHALL be listed by the attention queue (see "The attention queue unifies work awaiting a human") rather than by an importer-only listing.

**Titling.** The review detail page SHALL be titled by the download request — the request phrase of the download the import arrived from, the same identity the download detail page renders for the same story — composed by the web layer from existing facade reads without any new cross-module contract. When the import carries no download correlation, or a composing read fails, the title SHALL degrade to the delivered directory's basename, then to a neutral awaiting-review phrase. The delivered path SHALL render as labeled supporting detail, never as the title.

**Resolution affordances.** Resolution actions SHALL be labeled as imperative, verb-led, sentence-case fragments; an action's label SHALL name its object where the verb alone is ambiguous, and a destructive action SHALL name what it deletes. Consequence copy SHALL follow the label after an em-dash or sit in adjacent supporting text, and SHALL NOT be a parenthesized aside. Consequence copy SHALL state the composed system's actual contract: deterministic outcomes are stated plainly — rejecting a delivery as unusable resumes the search for a replacement; a plain rejection ends the story with nothing more tried — and hedged wording is reserved for genuine nondeterminism. An affordance that opens further input rather than committing SHALL carry a trailing ellipsis. The narration register's ban on internal vocabulary applies to affordance copy in full.

**Destructive confirmation.** The file-deleting resolutions SHALL render with low-emphasis destructive styling, SHALL never be the page's visually primary action, and SHALL commit only through an in-page confirmation step that restates the specific consequence and offers exactly two outcome-named choices — one that performs the deletion and one that declines it, each named by its outcome, never a bare yes/no. The confirmation SHALL function without client-side scripting and SHALL NOT use a browser dialog. Non-destructive resolutions SHALL NOT acquire a confirmation step.

**Match evidence.** For a match-review, the web UI SHALL present the candidate's **actual differences** as the primary content, not distance scores. It SHALL show a headline comparing the intended release (the submission hint, when present) with the candidate's identity; an album-field diff; and a per-track diff that marks retagged tracks, downloaded files matching no track, and candidate tracks no file supplies. The per-track diff SHALL de-emphasize unchanged rows and SHALL mark changed values with a word-level highlight and an explicit direction cue, so near-identical strings are distinguishable at a glance. Headline match quality SHALL be coarse and higher-is-better — a category word and/or rounded whole-number percentage — never a raw distance, a float, or a lower-is-better figure anywhere in visible text. Penalty reasons SHALL be visible in plain language; penalty amounts, raw distance, source identifiers, and release ids SHALL sit behind a single per-candidate disclosure whose summary names what it reveals. When a review lacks field-level differences (recorded before they were captured), the UI SHALL fall back to the score presentation — glossed in the same register — without error.

**Source-agnostic copy.** Visible review copy SHALL NOT name internal tooling. Absence-of-candidates copy SHALL speak source-agnostically of the connected metadata sources rather than glossing the matcher as any single source; a concrete candidate MAY truthfully name its own data source. The ID-entry action SHALL be labeled as accepting a release id from any connected source.

The web UI SHALL word the hint outcome truthfully: it SHALL state that the pinned release was not the best match only when the best candidate's release id differs from the pinned id, and otherwise (the best candidate is the pinned release) SHALL state that the pinned release matched but confidence was low.

#### Scenario: Resolving a review

- **WHEN** a user resolves a pending review with a valid choice
- **THEN** the importer facade's resolve command is dispatched and the review leaves the attention queue

#### Scenario: Stale resolution is a modeled error

- **WHEN** a user resolves a review that is no longer pending
- **THEN** the UI shows the facade's modeled conflict error and the import's state is unchanged

#### Scenario: The review is titled by what the user asked for

- **GIVEN** a pending review whose import arrived from a download
- **WHEN** the user opens the review
- **THEN** the page is titled by the download's request phrase — the same identity the download detail page shows — and the delivered path appears only as labeled supporting detail

#### Scenario: The title degrades without a download correlation

- **GIVEN** a pending review whose import carries no download correlation
- **WHEN** the user opens the review
- **THEN** the page is titled by the delivered directory's basename, and by a neutral awaiting-review phrase if no path is available

#### Scenario: A destructive resolution confirms in-page with outcome-named choices

- **GIVEN** a review offering a file-deleting resolution
- **WHEN** the user submits that resolution
- **THEN** the page re-renders an in-page confirmation restating the specific consequence with exactly two outcome-named choices, no files are deleted until the deleting choice is submitted, and declining returns to the review unchanged

#### Scenario: Consequence copy states the composed contract

- **GIVEN** a review offering both the unusable-delivery rejection and the plain rejection
- **WHEN** the user views the resolution actions
- **THEN** the unusable-delivery rejection's copy states that the search for a replacement continues, the plain rejection's copy states that nothing more will be tried, and neither consequence is a parenthesized aside

#### Scenario: The review page shows what differs, not just how much

- **GIVEN** a match-review whose candidate retags a track, leaves a downloaded file unmatched, and is missing a track
- **WHEN** the user opens the review
- **THEN** the page shows the intended-vs-candidate headline, the album-field diff, and a per-track diff marking the retag with a word-level highlight and direction cue, the extra file, and the missing track
- **AND** unchanged track rows render de-emphasized

#### Scenario: Match quality is coarse and higher-is-better

- **GIVEN** a match-review with candidates
- **WHEN** the user views a candidate's headline
- **THEN** match quality renders as a category word and/or rounded whole-number percentage where higher means better, and the raw distance, penalty amounts, source identifier, and release id are reachable only through the candidate's disclosure

#### Scenario: No tool names in visible copy

- **GIVEN** a review with no candidates at all
- **WHEN** the user opens the review
- **THEN** the absence is explained source-agnostically in terms of the connected metadata sources, and no internal tool name appears in visible text

#### Scenario: A pinned release that merely scored low is not called contradicted

- **GIVEN** a match-review reached with a pinned release id whose best candidate is that same release
- **WHEN** the user opens the review
- **THEN** the page states the pinned release matched but confidence was low, not that the hint was contradicted

#### Scenario: A legacy review still renders

- **GIVEN** a match-review recorded before field-level differences were captured
- **WHEN** the user opens the review
- **THEN** the page renders the score/penalty view glossed in the register and the resolution actions, without error

#### Scenario: Picking a candidate and entering an id are the two match actions

- **GIVEN** a match-review with candidates
- **WHEN** the user views the resolution actions
- **THEN** they can apply one of the listed candidates or enter a release id (labeled as accepting a release id from any connected source) to re-propose

### Requirement: BFF calls facades in-process only

All web UI data access SHALL occur in SvelteKit server routes (loads, actions, server endpoints) calling module facades in-process. The browser client SHALL NOT reach module code directly, and server-only modules SHALL NOT be importable into client bundles.

#### Scenario: No network hop behind the BFF

- **WHEN** any web UI page is served or action processed
- **THEN** the BFF performs no HTTP request to its own process or to localhost to obtain module data

#### Scenario: Server-only leak breaks the build

- **WHEN** a client-bundled component imports a facade or other server-only module
- **THEN** the build fails

### Requirement: Single-process daemon serves the UI

The production process SHALL start via a single entry point that boots both module runtimes (event stores, subscriptions, reactors, source pollers) and then serves the web UI. Background processing SHALL NOT depend on page traffic.

#### Scenario: One process serves pages and processes events

- **WHEN** the production entry point starts
- **THEN** the web UI responds on the configured port and a submitted download progresses through download and import with no further HTTP requests arriving

### Requirement: UI package meets the coverage gate

The web package SHALL meet the 100% line-and-branch coverage threshold via one merged root-level report across three vitest projects — `server` (node), `ssr` (node), and `client` (Browser Mode, Chromium) — with coverage inclusion configured so untested source files count against the gate. Permitted exclusions are limited to: `app.html`, `*.d.ts`, generated `.svelte-kit/` output, trivial hooks, and test/setup files. Any inline coverage-ignore pragma MUST carry a comment naming the compiler artifact it excuses. Playwright e2e SHALL remain outside the coverage threshold and SHALL run in CI as a phase of the out-of-process E2E tier against the built image, not as a separate job over a runner-local boot; a runner-local Playwright path MAY be kept as a non-gating developer convenience.

#### Scenario: Untested component fails the gate

- **WHEN** a source component exists in the web package with no test exercising it
- **THEN** the merged coverage report counts its uncovered lines and the gate fails

#### Scenario: Merged report spans node and browser tests

- **WHEN** the test gate runs server, ssr, and client projects
- **THEN** a single coverage report aggregates all three against the 100% threshold

#### Scenario: Playwright e2e gates the release from within the out-of-process tier

- **WHEN** the post-merge pipeline runs the Playwright parity smoke
- **THEN** it runs inside the out-of-process E2E tier against the built image, contributes to no coverage threshold, and its failure blocks publish via that tier's gate

### Requirement: Health endpoint reports readiness and version

The web interface SHALL expose an unauthenticated `GET /health` server route that returns a JSON body describing the process's readiness. The body SHALL include an overall `status` of `ok` or `degraded`, the running application `version` (sourced from the shipped package version, not from the environment), and a per-module `status` of `up` or `down` for each module runtime (`downloader` and `importer`). When every module runtime reports healthy, the route SHALL respond `200` with overall `status` `ok`. When any booted module runtime reports unhealthy, the route SHALL respond `503` with overall `status` `degraded`, and the body SHALL still enumerate each module's status so the unhealthy module is named. The route SHALL obtain module readiness by reading the runtime readiness snapshot in the SvelteKit server layer only; it SHALL NOT import module internals, scan an event store, or perform domain I/O to answer.

#### Scenario: Ready process reports ok with version

- **WHEN** a client issues `GET /health` against a process whose module runtimes are all healthy
- **THEN** the route responds `200` with a JSON body whose overall `status` is `ok`, whose `version` is the running application version, and whose `modules.downloader.status` and `modules.importer.status` are both `up`

#### Scenario: A degraded module drives a 503

- **WHEN** a client issues `GET /health` while a booted module runtime reports itself unhealthy
- **THEN** the route responds `503` with overall `status` `degraded` and the responding body names that module with `status` `down`

#### Scenario: No domain I/O or module-internal import behind the probe

- **WHEN** the `/health` route handles a request
- **THEN** it reads only the runtime readiness snapshot exposed through the server layer and performs no event-store scan, no third-party dependency call, and no import of module-internal code

### Requirement: Health endpoint meets the coverage gate

The `/health` server route SHALL be covered by the web package's merged 100% line-and-branch coverage gate, exercising both the ready (`200`/`ok`) and degraded (`503`/`degraded`) paths, with no new coverage carve-out introduced for it.

#### Scenario: Both status paths are exercised under the gate

- **WHEN** the web test gate runs
- **THEN** tests drive both the all-healthy and the degraded branches of the route and the merged coverage report counts the route with no threshold exclusion

### Requirement: Manual edition selection for release-group requests

The web UI SHALL surface downloads that are awaiting manual edition selection, presenting each candidate edition with its identifying metadata — title, release date, country, format, and track count — so a user can distinguish the editions. The UI SHALL let the user select one candidate edition, which resumes the download with that edition as the resolved target. A selection that the system rejects (e.g. the download is no longer awaiting selection) SHALL render as the modeled error, not a crash or a silent no-op. The UI SHALL accept the release-group identifier as a request kind when submitting a download.

#### Scenario: Awaiting-selection download lists its candidate editions

- **GIVEN** a download awaiting manual edition selection
- **WHEN** the user views it
- **THEN** the UI lists the candidate editions, each showing title, release date, country, format, and track count

#### Scenario: Selecting an edition resumes the download

- **GIVEN** a download awaiting manual edition selection is shown with its candidate editions
- **WHEN** the user selects one edition
- **THEN** the UI submits that selection and the download proceeds with the chosen edition as its target

#### Scenario: A stale selection renders the modeled error

- **GIVEN** a download that has left the awaiting-selection state
- **WHEN** the user submits a selection for it
- **THEN** the UI renders the modeled rejection error rather than crashing or silently ignoring it

#### Scenario: Submitting a request by release-group identifier

- **GIVEN** a user submitting a new download
- **WHEN** they provide a MusicBrainz release-group identifier as the request
- **THEN** the UI submits a release-group request that the system resolves by selecting a representative edition

### Requirement: The attention queue unifies work awaiting a human

The web UI SHALL present a single attention queue that lists every item across modules currently waiting on a human decision — at minimum the importer's pending match reviews and the downloader's downloads awaiting manual edition selection — as one list ordered longest-waiting first. Each item SHALL name **the ask** — the decision waiting on the user — in plain, action-oriented language, SHALL be titled by its download request where the correlation is available (degrading as the review titling requirement specifies), and SHALL link to the surface where the decision is made. Visible queue text SHALL NOT name the owning module or any architecture noun; a machine-readable module attribute MAY remain on the row for styling and tests. The queue SHALL be composed by the web layer from the module facades' own read models; the composition SHALL NOT introduce a cross-module contract between the bounded contexts. When one module's read fails, the queue SHALL render the other module's items alongside a modeled error for the failed section, not fail as a whole. Any capability that adds a new human-decision pause SHALL surface its pending items in this queue.

#### Scenario: Items from both modules appear as one queue

- **GIVEN** a pending import review and a download awaiting manual edition selection
- **WHEN** the user opens the attention queue
- **THEN** both items appear in one list, longest-waiting first, each naming the decision asked of the user in action-oriented language and linking to its resolution surface

#### Scenario: The queue never names the machinery

- **GIVEN** attention items originating from both modules
- **WHEN** the user reads the queue
- **THEN** no visible text names a module or architecture noun, while each row still carries its machine-readable module attribute

#### Scenario: Resolving an item removes it from the queue

- **GIVEN** an attention queue showing an awaiting-selection download
- **WHEN** the user follows its link and selects an edition
- **THEN** the download proceeds and no longer appears in the attention queue

#### Scenario: One module failing does not empty the queue

- **GIVEN** one module's facade read fails
- **WHEN** the user opens the attention queue
- **THEN** the other module's items are listed and the failed section renders a modeled error message

### Requirement: Pending attention is discoverable from the navigation

The web UI SHALL show, in the site navigation, the count of items currently in the attention queue, so waiting work is discoverable from any page. A zero count SHALL render without a badge rather than a zero.

#### Scenario: The badge reflects the queue

- **GIVEN** two items awaiting a human across modules
- **WHEN** the user views any page
- **THEN** the navigation shows the attention entry with a count of 2

#### Scenario: No badge when nothing waits

- **GIVEN** no pending reviews and no awaiting-selection downloads
- **WHEN** the user views any page
- **THEN** the attention entry renders without a count badge

### Requirement: Awaiting-selection downloads present as action-needed

The web UI SHALL present a download awaiting manual edition selection as requiring the user's action — with a distinct badge tone and an explicit waiting-for-your-choice description — never as generic in-progress work or a bare "(resolving…)" placeholder. The determination that a download is awaiting the user's action SHALL come from the downloader facade's decided awaiting-selection flag, and its membership in the attention queue's edition-selection arm SHALL follow that flag rather than a re-derivation from the status enum or the badge-tone table; the badge tone remains a presentational mapping the web layer owns.

#### Scenario: The list distinguishes an awaiting-selection download

- **GIVEN** the downloads list contains an awaiting-selection download and a searching download
- **WHEN** the user views the list
- **THEN** the awaiting-selection row carries a visually distinct action-needed tone and states that an edition choice is awaited, while the searching row remains generic in-progress

#### Scenario: Attention-queue membership follows the decided flag

- **GIVEN** a download whose status DTO reports awaiting-selection as true
- **WHEN** the attention queue is composed
- **THEN** the download appears in the edition-selection arm because of that flag, not because of its badge tone or status name

### Requirement: Download detail presents the full download-through-import lifecycle

The web UI's download detail SHALL present the download's complete history spanning both bounded contexts — the downloader's steps and, once the download has been handed off, the importer's steps — as a single flat timeline ordered by occurrence time. The timeline SHALL speak in one narrator voice: no rendered text SHALL attribute an entry to its originating module or name the system's internal structure (module names, "importer", "staged", hand-off vocabulary); the originating module SHALL be retained only as a non-rendered DOM attribute for styling and tests. The timeline SHALL be composed by the web layer from the downloader and importer facades' own read models; the composition SHALL NOT introduce a cross-module contract between the bounded contexts (the same principle as the attention queue). When the importer read fails or no import exists yet for the download, the detail SHALL render the downloader's timeline alongside a modeled, non-failing indication that the import has not started or is momentarily unavailable, never a page-level failure. The correlation between a download and its import SHALL be the download id.

The timeline SHALL render every entry's occurrence time: relative phrasing under 24 hours, absolute date and time beyond, with the full absolute timestamp always available via the entry's `time` element metadata. Date changes SHALL be marked between entries. The closing entry of a terminal download SHALL carry a coarse total-duration gloss from request to ending.

While the download is not terminal, the timeline SHALL end with exactly one synthesized in-progress entry describing the current phase in present-progressive voice, derived from the status read models the page already loads (never from a new wire contract). During an active download, live progress SHALL be embedded in this in-progress entry rather than rendered as a separate widget; when progress is momentarily unavailable, the entry SHALL say so rather than render a blank indicator. Phases awaiting the user (edition choice, match review) SHALL present as attention-styled in-progress entries linking to the action. A terminal download SHALL have no in-progress entry — its closing entry ends the story.

An entry carrying diagnostic payload (full remote paths, raw reason codes, staging paths, raw match distance) SHALL present that payload behind a per-entry native disclosure element, rendered only when payload exists; the always-visible entry text SHALL carry the human-readable account on its own.

#### Scenario: A fulfilled, imported download shows both contexts as one timeline

- **GIVEN** a download that was handed off to the importer and applied into the library
- **WHEN** a user opens that download's detail
- **THEN** the timeline shows the downloader steps followed by the importer steps (matching, any review and its resolution, applied) in occurrence order, with no rendered module attribution on any entry

#### Scenario: An import rejection and its retry interleave correctly

- **GIVEN** a download whose import was rejected-and-retried, reviving it for another download and import round
- **WHEN** a user opens that download's detail
- **THEN** the timeline interleaves the importer rejection, the downloader's revived attempt, and the subsequent import strictly in occurrence order rather than as two disjoint blocks

#### Scenario: The import section degrades independently

- **WHEN** the importer read fails or no import exists yet for a download
- **THEN** the downloader timeline still renders, accompanied by a modeled non-failing indication in the unified voice, and the page does not fail

#### Scenario: Hand-off and library import are not conflated

- **WHEN** the timeline renders the downloader's hand-off and the importer's applied outcome
- **THEN** the hand-off entry reads as the download completing and being prepared for the library, the applied entry reads as added to the library, and each names its own distinct location in its disclosure or labeled placement — without either entry naming the internal module structure

#### Scenario: Every entry shows when it happened

- **WHEN** a user opens a download's detail
- **THEN** every timeline entry renders its occurrence time — relative under 24 hours, absolute beyond — with the full absolute timestamp available on the entry's time metadata

#### Scenario: An active download always shows what is happening now

- **WHEN** a user opens the detail of a non-terminal download
- **THEN** the timeline's final entry is a single synthesized in-progress entry describing the current phase in present-progressive voice

#### Scenario: A just-submitted download is never an empty history

- **WHEN** a user opens the detail of a download immediately after submitting it
- **THEN** the timeline shows the requested entry followed by the current-phase in-progress entry, never an empty state

#### Scenario: Download progress lives in the in-progress entry

- **WHEN** a user views the detail of a download that is downloading
- **THEN** live progress renders embedded in the in-progress entry, and if progress is momentarily unavailable the entry says so instead of rendering a blank indicator

#### Scenario: Diagnostic payload is one disclosure away, and only where it exists

- **WHEN** a user views a timeline entry that carries diagnostic payload
- **THEN** the payload is available behind that entry's disclosure element while the visible text stands alone as a human-readable account
- **AND** entries without payload render no disclosure control

#### Scenario: A failed download's story has an ending

- **WHEN** a user opens the detail of a failed download
- **THEN** the timeline ends with a terminal entry stating in plain words what ended the download, plus one remediation hint where a real action exists, and no in-progress entry follows it

### Requirement: The BFF renders decided lifecycle and authorization facts, not re-derived ones

The web BFF SHALL render lifecycle and authorization facts as decided by the owning module and surfaced on the module's facade DTOs — it SHALL NOT re-derive such a fact from a wire status enum or a presentation lookup table. Specifically: whether a download may be cancelled SHALL be read from the download status DTO's decided cancellable flag; whether a download is awaiting a human's edition choice SHALL be read from the download status DTO's decided awaiting-selection flag; and which resolution verbs a pending review offers SHALL be read from the pending-review DTO's permitted-action set. The BFF MAY retain purely presentational mappings that carry no business rule — for example the mapping from status to a badge colour, or how a permitted verb is laid out — because deleting the UI would not lose a decision. When a decided field is absent from a DTO (an older producer), the BFF SHALL degrade safely — omit the affordance — rather than fall back to re-deriving the fact.

#### Scenario: The cancel affordance follows the decided flag

- **GIVEN** two downloads whose status DTOs report cancellable as true and false respectively
- **WHEN** the user views each
- **THEN** the cancel affordance is offered for the cancellable one and withheld for the other, determined by the flag rather than by inspecting the status value

#### Scenario: Review actions follow the decided permitted set

- **GIVEN** a pending review whose DTO permits a specific set of resolution verbs
- **WHEN** the user opens the review
- **THEN** exactly those verbs are offered as actions, and a verb the review does not permit (for example reject-and-retry-download without a retained candidate) is not presented

#### Scenario: A missing decided field degrades safely

- **GIVEN** a status DTO that omits the cancellable flag, or a pending-review DTO that omits its permitted-action set
- **WHEN** the BFF renders it
- **THEN** it withholds the corresponding affordance without error, rather than re-deriving the fact from the status enum

### Requirement: Timeline copy follows a single register

All user-visible copy — the download detail, the attention queue, the review surface, and any surface added later — SHALL follow one register. Completed timeline entries render as past-tense, verb-led fragments in sentence case without trailing periods; the in-progress entry in present progressive; no first-person voice; "you/your" only for user-initiated facts. Imperative affordances follow the affordance rules (verb-led sentence-case labels, object-naming destructive verbs, em-dash consequences, no parenthesized asides). Visible text SHALL contain no internal vocabulary — no enum identifiers, no architecture nouns, no internal tool names — while real-world names the user owns (source network, MusicBrainz, formats, album titles, peer usernames) are permitted. Every failure entry SHALL state what happened and what happens (or can be done) next in at most two sentences. Numbers SHALL be human-formatted: failure reason codes render through a plain-language gloss map with a safe generic fallback (raw code relegated to the entry's disclosure) for unmapped values, and match quality renders coarse and higher-is-better with the raw value only in disclosure. Unknown entry kinds SHALL render a neutral tolerant-reader line in the same register.

Consequence and narration copy SHALL state the composed system's actual contract — the web layer reads both modules' facades and narrates with the whole system's knowledge — hedging only genuine nondeterminism. In particular, the narration of a plain import rejection SHALL state that nothing more will be tried, and the narration of an unusable-delivery rejection SHALL state that the search resumes; neither SHALL suggest a retry that the system will not perform. The narration of a resolved review SHALL reuse the resolving action's verb, tense-shifted — choosing an affordance verb is choosing its timeline verb.

#### Scenario: A failure entry is glossed with its raw code in disclosure

- **WHEN** the timeline renders a download failure whose reason code has a gloss
- **THEN** the visible text carries the plain-language gloss and a next-step clause, and the raw code appears only in the entry's disclosure

#### Scenario: An unmapped reason code degrades safely

- **WHEN** the timeline renders a failure whose reason code has no gloss entry
- **THEN** the visible text falls back to a generic register-compliant failure line and the raw code appears only in the entry's disclosure

#### Scenario: Match confidence is a percentage, not a float

- **WHEN** the timeline renders an automatic confident-match selection
- **THEN** the visible text carries a whole-number match percentage and the raw distance appears only in the entry's disclosure

#### Scenario: Rejection narration tells the truth about what happens next

- **WHEN** the timeline narrates a plain import rejection and an unusable-delivery rejection
- **THEN** the plain rejection's entry states that nothing more will be tried, the unusable-delivery entry states that the search resumes, and neither hedges a deterministic outcome

#### Scenario: The resolution narration echoes the action's verb

- **GIVEN** a review resolved through a labeled resolution action
- **WHEN** the timeline narrates that resolution
- **THEN** the entry reuses the action's verb tense-shifted into the narration register

### Requirement: The download detail refreshes itself while the story is unsettled

While the displayed download's story is unsettled — the download is not terminal, OR it was
delivered (fulfilled) and its import has not yet reported its own decided settledness (including
the asynchronous window where no import exists yet, and a failed importer read), OR its import
rejected the delivery (which the downloader may still consume and revive) — the detail page
SHALL periodically re-fetch its own data and re-render without user action, so the timeline and
its in-progress entry track reality; refreshing SHALL stop once the whole story has settled and
on leaving the page. A delivered download whose import side is absent or unreadable SHALL NOT
be presented as in the library. A failed re-fetch SHALL be surfaced as a modeled indication
beside the timeline, never a silently stale page. The refresh trigger SHALL sit behind a single
swappable seam owned by the page layer, with the timeline presentation consuming page data only,
so a future push-based freshness source replaces the trigger without touching the presentation.
The refresh SHALL reuse the page's existing load path and SHALL NOT introduce a new wire
endpoint.

#### Scenario: An active download's page advances by itself

- **WHEN** a user keeps the detail of an active download open while the download progresses
- **THEN** the timeline gains the new entries and the in-progress entry advances without a manual reload

#### Scenario: A delivered download keeps refreshing until its import settles

- **WHEN** a user views a fulfilled download whose import does not exist yet or has not settled
- **THEN** the page keeps refreshing, presents an in-progress entry, and does not claim the release is in the library

#### Scenario: A settled story's page rests

- **WHEN** the displayed download's story has fully settled (a failed ending, or a delivery whose import reports itself settled and did not reject)
- **THEN** periodic refreshing stops

#### Scenario: A rejected import keeps the page watching for the revival

- **WHEN** a user views a fulfilled download whose import rejected the delivery
- **THEN** the page keeps refreshing, so the downloader's asynchronous revival (when the rejection warrants one) appears without a manual reload

#### Scenario: A failed refresh is visible

- **WHEN** a periodic re-fetch fails while the page stays open
- **THEN** the page indicates its data may be momentarily stale instead of silently freezing

### Requirement: Never-resolved downloads are titled by their request

A download whose metadata never resolved SHALL be titled by what the user asked for — the
artist/title descriptor as given, or a neutral unknown-release label for an id-only request —
in both the master list and the detail heading. A resolving placeholder title SHALL appear only
while resolution is genuinely pending, never as the permanent title of a terminally failed
download.

#### Scenario: A metadata-failed download keeps a meaningful title

- **WHEN** a user views the list or detail of a download whose metadata resolution failed
- **THEN** its title renders from the request as given (or a neutral unknown-release label for an
  id-only request), not a resolving placeholder

### Requirement: The downloads queue reads newest first

The downloads master list SHALL present downloads ordered by when each was requested, newest first, so the entries a user most recently created — the ones they most likely came to check — are visible without scrolling. The ordering SHALL be keyed on the download's stated requested-at fact, not on storage or replay order. This ordering applies to the downloads master list only; the attention queue keeps its own longest-waiting-first ordering.

#### Scenario: Newest request appears at the top

- **WHEN** a user views the downloads master list while downloads requested at different times exist
- **THEN** the list presents them newest-requested first, with the most recent request at the top

#### Scenario: A newly submitted request leads the queue

- **WHEN** a user submits a new download request and returns to the downloads view
- **THEN** the new download appears at the top of the master list

### Requirement: Small screens present one downloads pane at a time

At narrow viewport widths — below the downloads view's existing side-by-side breakpoint — the download detail and new-request routes SHALL present only the detail pane: the master queue SHALL be hidden such that it is absent from the accessibility tree and keyboard-focus order, not merely invisible. A "Back to queue" link SHALL appear at the top of the detail pane's content at these widths, returning the user to the downloads list; it SHALL be present on deep-linked entry as well as in-app navigation. The list route keeps its current presentation at all widths, and wide viewports keep the two-pane presentation unchanged.

DOM source order SHALL remain list-then-detail at every width — the collapse hides, and never reorders, content (per the accessibility requirements of the presentation capability).

#### Scenario: The new-request form is immediately visible on a small screen

- **WHEN** a user on a narrow viewport opens the new-request route
- **THEN** the request form is presented without the queue above it, and the form is reachable without scrolling past queue entries

#### Scenario: A download's detail stands alone on a small screen

- **WHEN** a user on a narrow viewport opens a download's detail — by selecting it from the queue or by following a deep link
- **THEN** only that download's detail is presented, with a "Back to queue" link at the top of the pane

#### Scenario: The hidden queue is out of the keyboard-focus order

- **WHEN** a user on a narrow viewport tabs through the new-request or detail route
- **THEN** focus never enters the hidden queue pane

#### Scenario: Wide viewports keep both panes

- **WHEN** a user at a wide viewport opens the new-request or detail route
- **THEN** the queue and the detail pane present side by side exactly as before


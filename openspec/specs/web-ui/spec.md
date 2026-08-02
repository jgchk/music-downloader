# web-ui Specification

## Purpose

Define the SvelteKit BFF web interface — the product's sole interface at functional parity with the retired MCP tools — including its in-process facade access rule, the single-process daemon shape, and the testing/coverage regime that keeps the UI package inside the 100% merged coverage gate.

## Requirements
### Requirement: Acquisition submission and cancellation

The web UI SHALL let a user submit an acquisition (target plus quality policy, matching the downloader facade's submit contract) and cancel a pending acquisition. Failures returned by the facade SHALL render as actionable messages, not crashes.

#### Scenario: Successful submission

- **WHEN** a user submits a valid acquisition form
- **THEN** the BFF dispatches the downloader facade's submit command in-process and the UI shows the new acquisition with its identifier and current phase

#### Scenario: Rejected submission renders the modeled error

- **WHEN** the facade returns a modeled validation or conflict error for a submission
- **THEN** the UI re-renders the form with the failure's message and no acquisition is created

#### Scenario: Cancellation

- **WHEN** a user cancels an acquisition that is still cancellable
- **THEN** the facade's cancel command is dispatched and the UI reflects the cancelled state

### Requirement: Acquisition progress observation

The web UI SHALL show the user each acquisition's current phase and outcome (including failure reasons) from the downloader facade's read models.

The acquisitions view SHALL present the acquisitions as a compact master list — each acquisition rendering its target description and a phase signal (its in-progress phase, or its terminal done/failed state) — beside a detail pane that shows the selected acquisition in full. Each acquisition's outcome (its deposited location, or its failure reason) SHALL be surfaced in the detail view for the selected acquisition, NOT as an inline column of the master list, so the master stays scannable and one long value (a file path or a multi-clause reason) cannot distort it.

Status SHALL be presented in human phrases, never as raw status enum identifiers (for example `MetadataFailed` or `Conflicted`); counts SHALL be pluralized correctly and zero-count segments omitted. The detail header SHALL label the library location when one exists and SHALL NOT repeat the failure account that the timeline's terminal entry already gives.

Failure reasons SHALL be surfaced through already-visible outcome text — the outcome summary and the timeline on the detail view — and SHALL NOT be duplicated behind a control that reveals the same human-readable reasons. Per-entry disclosure elements SHALL reveal only diagnostic payload (raw codes, paths, raw scores) distinct from the visible human-readable account. The phase badge SHALL be a status indicator only and SHALL NOT carry a reason-revealing disclosure. No disclosure affordance SHALL be presented where there is no payload to show, so that the user is never offered a control that leads to an empty result.

#### Scenario: Progress listing

- **WHEN** a user opens the acquisitions view while acquisitions exist in various phases
- **THEN** each acquisition renders in the master list with its target description and a human-phrase phase signal, with correctly pluralized counts and no raw enum identifiers

#### Scenario: Outcome is shown in the detail view on selection

- **WHEN** a user selects an acquisition
- **THEN** the detail view shows that acquisition's outcome — a labeled library location for a fulfilled acquisition, or the timeline's plain-words terminal account for a failed one — in human phrases

#### Scenario: Human reasons visible once, diagnostics behind disclosure

- **WHEN** a user views a failed acquisition whose history carries failure reasons
- **THEN** the human-readable reasons appear in visible text exactly once, any raw diagnostic payload sits behind per-entry disclosure, and the phase badge presents no reveal control

#### Scenario: No disclosure control when there is nothing to reveal

- **WHEN** a user views a timeline entry or acquisition that carries no diagnostic payload
- **THEN** no disclosure affordance is presented, rather than a control that expands to an empty result


### Requirement: Import review resolution

The web UI SHALL let the user resolve a pending import review (matching the importer facade's resolve contract), at parity with the retired `resolve_review` MCP tool. Pending reviews SHALL be listed by the attention queue (see "The attention queue unifies work awaiting a human") rather than by an importer-only listing.

For a match-review, the web UI SHALL present the candidate's **actual differences** as the primary content, not beets' distance scores. It SHALL show a headline comparing the intended release (the submission hint, when present) with the candidate's identity (artist, album, source, release id); an album-field diff; and a per-track diff that marks retagged tracks, downloaded files matching no track, and candidate tracks no file supplies. The distance and per-penalty breakdown MAY still be shown but SHALL be secondary to the differences and accompanied by plain-language labels for beets' penalty names. When a review lacks the field-level differences (recorded before they were captured), the UI SHALL fall back to the distance/penalty presentation without error.

The web UI SHALL word the hint outcome truthfully: it SHALL state that the pinned release was not the best match only when the best candidate's release id differs from the pinned id, and otherwise (the best candidate is the pinned release) SHALL state that the pinned release matched but confidence was low. The ID-entry action SHALL be labeled as accepting a release id from any source beets can resolve, not MusicBrainz alone.

#### Scenario: Resolving a review

- **WHEN** a user resolves a pending review with a valid choice
- **THEN** the importer facade's resolve command is dispatched and the review leaves the attention queue

#### Scenario: Stale resolution is a modeled error

- **WHEN** a user resolves a review that is no longer pending
- **THEN** the UI shows the facade's modeled conflict error and the import's state is unchanged

#### Scenario: The review page shows what differs, not just how much

- **GIVEN** a match-review whose candidate retags a track, leaves a downloaded file unmatched, and is missing a track
- **WHEN** the user opens the review
- **THEN** the page shows the intended-vs-candidate headline, the album-field diff, and a per-track diff marking the retag, the extra file, and the missing track
- **AND** the penalty percentages, if shown, are secondary and plainly labeled

#### Scenario: A pinned release that merely scored low is not called contradicted

- **GIVEN** a match-review reached with a pinned release id whose best candidate is that same release
- **WHEN** the user opens the review
- **THEN** the page states the pinned release matched but confidence was low, not that the hint was contradicted

#### Scenario: A legacy review still renders

- **GIVEN** a match-review recorded before field-level differences were captured
- **WHEN** the user opens the review
- **THEN** the page renders the distance/penalty view and the resolution actions, without error

#### Scenario: Picking a candidate and entering an id are the two match actions

- **GIVEN** a match-review with candidates
- **WHEN** the user views the resolution actions
- **THEN** they can apply one of the listed candidates or enter a release id (labeled as accepting any source beets resolves) to re-propose

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
- **THEN** the web UI responds on the configured port and a submitted acquisition progresses through download and import with no further HTTP requests arriving

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

The web UI SHALL surface acquisitions that are awaiting manual edition selection, presenting each candidate edition with its identifying metadata — title, release date, country, format, and track count — so a user can distinguish the editions. The UI SHALL let the user select one candidate edition, which resumes the acquisition with that edition as the resolved target. A selection that the system rejects (e.g. the acquisition is no longer awaiting selection) SHALL render as the modeled error, not a crash or a silent no-op. The UI SHALL accept the release-group identifier as a request kind when submitting an acquisition.

#### Scenario: Awaiting-selection acquisition lists its candidate editions

- **GIVEN** an acquisition awaiting manual edition selection
- **WHEN** the user views it
- **THEN** the UI lists the candidate editions, each showing title, release date, country, format, and track count

#### Scenario: Selecting an edition resumes the acquisition

- **GIVEN** an acquisition awaiting manual edition selection is shown with its candidate editions
- **WHEN** the user selects one edition
- **THEN** the UI submits that selection and the acquisition proceeds with the chosen edition as its target

#### Scenario: A stale selection renders the modeled error

- **GIVEN** an acquisition that has left the awaiting-selection state
- **WHEN** the user submits a selection for it
- **THEN** the UI renders the modeled rejection error rather than crashing or silently ignoring it

#### Scenario: Submitting a request by release-group identifier

- **GIVEN** a user submitting a new acquisition
- **WHEN** they provide a MusicBrainz release-group identifier as the request
- **THEN** the UI submits a release-group request that the system resolves by selecting a representative edition

### Requirement: The attention queue unifies work awaiting a human

The web UI SHALL present a single attention queue that lists every item across modules currently waiting on a human decision — at minimum the importer's pending match reviews and the downloader's acquisitions awaiting manual edition selection — as one list ordered longest-waiting first. Each item SHALL identify its module and kind, describe what is being decided, and link to the surface where the decision is made. The queue SHALL be composed by the web layer from the module facades' own read models; the composition SHALL NOT introduce a cross-module contract between the bounded contexts. When one module's read fails, the queue SHALL render the other module's items alongside a modeled error for the failed section, not fail as a whole. Any capability that adds a new human-decision pause SHALL surface its pending items in this queue.

#### Scenario: Items from both modules appear as one queue

- **GIVEN** a pending import review and an acquisition awaiting manual edition selection
- **WHEN** the user opens the attention queue
- **THEN** both items appear in one list, longest-waiting first, each naming its module and kind and linking to its resolution surface

#### Scenario: Resolving an item removes it from the queue

- **GIVEN** an attention queue showing an awaiting-selection acquisition
- **WHEN** the user follows its link and selects an edition
- **THEN** the acquisition proceeds and no longer appears in the attention queue

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

- **GIVEN** no pending reviews and no awaiting-selection acquisitions
- **WHEN** the user views any page
- **THEN** the attention entry renders without a count badge

### Requirement: Awaiting-selection acquisitions present as action-needed

The web UI SHALL present an acquisition awaiting manual edition selection as requiring the user's action — with a distinct badge tone and an explicit waiting-for-your-choice description — never as generic in-progress work or a bare "(resolving…)" placeholder. The determination that an acquisition is awaiting the user's action SHALL come from the downloader facade's decided awaiting-selection flag, and its membership in the attention queue's edition-selection arm SHALL follow that flag rather than a re-derivation from the status enum or the badge-tone table; the badge tone remains a presentational mapping the web layer owns.

#### Scenario: The list distinguishes an awaiting-selection acquisition

- **GIVEN** the acquisitions list contains an awaiting-selection acquisition and a searching acquisition
- **WHEN** the user views the list
- **THEN** the awaiting-selection row carries a visually distinct action-needed tone and states that an edition choice is awaited, while the searching row remains generic in-progress

#### Scenario: Attention-queue membership follows the decided flag

- **GIVEN** an acquisition whose status DTO reports awaiting-selection as true
- **WHEN** the attention queue is composed
- **THEN** the acquisition appears in the edition-selection arm because of that flag, not because of its badge tone or status name

### Requirement: Acquisition detail presents the full download-through-import lifecycle

The web UI's acquisition detail SHALL present the acquisition's complete history spanning both bounded contexts — the downloader's steps and, once the acquisition has been handed off, the importer's steps — as a single flat timeline ordered by occurrence time. The timeline SHALL speak in one narrator voice: no rendered text SHALL attribute an entry to its originating module or name the system's internal structure (module names, "importer", "staged", hand-off vocabulary); the originating module SHALL be retained only as a non-rendered DOM attribute for styling and tests. The timeline SHALL be composed by the web layer from the downloader and importer facades' own read models; the composition SHALL NOT introduce a cross-module contract between the bounded contexts (the same principle as the attention queue). When the importer read fails or no import exists yet for the acquisition, the detail SHALL render the downloader's timeline alongside a modeled, non-failing indication that the import has not started or is momentarily unavailable, never a page-level failure. The correlation between an acquisition and its import SHALL be the acquisition id.

The timeline SHALL render every entry's occurrence time: relative phrasing under 24 hours, absolute date and time beyond, with the full absolute timestamp always available via the entry's `time` element metadata. Date changes SHALL be marked between entries. The closing entry of a terminal acquisition SHALL carry a coarse total-duration gloss from request to ending.

While the acquisition is not terminal, the timeline SHALL end with exactly one synthesized in-progress entry describing the current phase in present-progressive voice, derived from the status read models the page already loads (never from a new wire contract). During an active download, live progress SHALL be embedded in this in-progress entry rather than rendered as a separate widget; when progress is momentarily unavailable, the entry SHALL say so rather than render a blank indicator. Phases awaiting the user (edition choice, match review) SHALL present as attention-styled in-progress entries linking to the action. A terminal acquisition SHALL have no in-progress entry — its closing entry ends the story.

An entry carrying diagnostic payload (full remote paths, raw reason codes, staging paths, raw match distance) SHALL present that payload behind a per-entry native disclosure element, rendered only when payload exists; the always-visible entry text SHALL carry the human-readable account on its own.

#### Scenario: A fulfilled, imported acquisition shows both contexts as one timeline

- **GIVEN** an acquisition that was handed off to the importer and applied into the library
- **WHEN** a user opens that acquisition's detail
- **THEN** the timeline shows the downloader steps followed by the importer steps (matching, any review and its resolution, applied) in occurrence order, with no rendered module attribution on any entry

#### Scenario: An import rejection and its retry interleave correctly

- **GIVEN** an acquisition whose import was rejected-and-retried, reviving it for another download and import round
- **WHEN** a user opens that acquisition's detail
- **THEN** the timeline interleaves the importer rejection, the downloader's revived attempt, and the subsequent import strictly in occurrence order rather than as two disjoint blocks

#### Scenario: The import section degrades independently

- **WHEN** the importer read fails or no import exists yet for an acquisition
- **THEN** the downloader timeline still renders, accompanied by a modeled non-failing indication in the unified voice, and the page does not fail

#### Scenario: Hand-off and library import are not conflated

- **WHEN** the timeline renders the downloader's hand-off and the importer's applied outcome
- **THEN** the hand-off entry reads as the download completing and being prepared for the library, the applied entry reads as added to the library, and each names its own distinct location in its disclosure or labeled placement — without either entry naming the internal module structure

#### Scenario: Every entry shows when it happened

- **WHEN** a user opens an acquisition's detail
- **THEN** every timeline entry renders its occurrence time — relative under 24 hours, absolute beyond — with the full absolute timestamp available on the entry's time metadata

#### Scenario: An active acquisition always shows what is happening now

- **WHEN** a user opens the detail of a non-terminal acquisition
- **THEN** the timeline's final entry is a single synthesized in-progress entry describing the current phase in present-progressive voice

#### Scenario: A just-submitted acquisition is never an empty history

- **WHEN** a user opens the detail of an acquisition immediately after submitting it
- **THEN** the timeline shows the requested entry followed by the current-phase in-progress entry, never an empty state

#### Scenario: Download progress lives in the in-progress entry

- **WHEN** a user views the detail of an acquisition that is downloading
- **THEN** live progress renders embedded in the in-progress entry, and if progress is momentarily unavailable the entry says so instead of rendering a blank indicator

#### Scenario: Diagnostic payload is one disclosure away, and only where it exists

- **WHEN** a user views a timeline entry that carries diagnostic payload
- **THEN** the payload is available behind that entry's disclosure element while the visible text stands alone as a human-readable account
- **AND** entries without payload render no disclosure control

#### Scenario: A failed acquisition's story has an ending

- **WHEN** a user opens the detail of a failed acquisition
- **THEN** the timeline ends with a terminal entry stating in plain words what ended the acquisition, plus one remediation hint where a real action exists, and no in-progress entry follows it


### Requirement: The BFF renders decided lifecycle and authorization facts, not re-derived ones

The web BFF SHALL render lifecycle and authorization facts as decided by the owning module and surfaced on the module's facade DTOs — it SHALL NOT re-derive such a fact from a wire status enum or a presentation lookup table. Specifically: whether an acquisition may be cancelled SHALL be read from the acquisition status DTO's decided cancellable flag; whether an acquisition is awaiting a human's edition choice SHALL be read from the acquisition status DTO's decided awaiting-selection flag; and which resolution verbs a pending review offers SHALL be read from the pending-review DTO's permitted-action set. The BFF MAY retain purely presentational mappings that carry no business rule — for example the mapping from status to a badge colour, or how a permitted verb is laid out — because deleting the UI would not lose a decision. When a decided field is absent from a DTO (an older producer), the BFF SHALL degrade safely — omit the affordance — rather than fall back to re-deriving the fact.

#### Scenario: The cancel affordance follows the decided flag

- **GIVEN** two acquisitions whose status DTOs report cancellable as true and false respectively
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

All acquisition-detail copy SHALL follow one register: completed timeline entries as past-tense,
verb-led fragments in sentence case without trailing periods; the in-progress entry in present
progressive; no first-person voice; "you/your" only for user-initiated facts. Visible text SHALL
contain no internal vocabulary — no enum identifiers, no architecture nouns — while real-world
names the user owns (source network, MusicBrainz, formats, album titles, peer usernames) are
permitted. Every failure entry SHALL state what happened and what happens (or can be done) next
in at most two sentences. Numbers SHALL be human-formatted: failure reason codes render through a
plain-language gloss map with a safe generic fallback (raw code relegated to the entry's
disclosure) for unmapped values, and match distance renders as a whole-number match percentage
with the raw value only in disclosure. Unknown entry kinds SHALL render a neutral
tolerant-reader line in the same register.

#### Scenario: A failure entry is glossed with its raw code in disclosure

- **WHEN** the timeline renders a download failure whose reason code has a gloss
- **THEN** the visible text carries the plain-language gloss and a next-step clause, and the raw code appears only in the entry's disclosure

#### Scenario: An unmapped reason code degrades safely

- **WHEN** the timeline renders a failure whose reason code has no gloss entry
- **THEN** the visible text falls back to a generic register-compliant failure line and the raw code appears only in the entry's disclosure

#### Scenario: Match confidence is a percentage, not a float

- **WHEN** the timeline renders an automatic confident-match selection
- **THEN** the visible text carries a whole-number match percentage and the raw distance appears only in the entry's disclosure

### Requirement: The acquisition detail refreshes itself while the story is unsettled

While the displayed acquisition's story is unsettled — the acquisition is not terminal, OR it was
delivered (fulfilled) and its import has not yet reported its own decided settledness (including
the asynchronous window where no import exists yet, and a failed importer read), OR its import
rejected the delivery (which the downloader may still consume and revive) — the detail page
SHALL periodically re-fetch its own data and re-render without user action, so the timeline and
its in-progress entry track reality; refreshing SHALL stop once the whole story has settled and
on leaving the page. A delivered acquisition whose import side is absent or unreadable SHALL NOT
be presented as in the library. A failed re-fetch SHALL be surfaced as a modeled indication
beside the timeline, never a silently stale page. The refresh trigger SHALL sit behind a single
swappable seam owned by the page layer, with the timeline presentation consuming page data only,
so a future push-based freshness source replaces the trigger without touching the presentation.
The refresh SHALL reuse the page's existing load path and SHALL NOT introduce a new wire
endpoint.

#### Scenario: An active acquisition's page advances by itself

- **WHEN** a user keeps the detail of an active acquisition open while the acquisition progresses
- **THEN** the timeline gains the new entries and the in-progress entry advances without a manual reload

#### Scenario: A delivered acquisition keeps refreshing until its import settles

- **WHEN** a user views a fulfilled acquisition whose import does not exist yet or has not settled
- **THEN** the page keeps refreshing, presents an in-progress entry, and does not claim the release is in the library

#### Scenario: A settled story's page rests

- **WHEN** the displayed acquisition's story has fully settled (a failed ending, or a delivery whose import reports itself settled and did not reject)
- **THEN** periodic refreshing stops

#### Scenario: A rejected import keeps the page watching for the revival

- **WHEN** a user views a fulfilled acquisition whose import rejected the delivery
- **THEN** the page keeps refreshing, so the downloader's asynchronous revival (when the rejection warrants one) appears without a manual reload

#### Scenario: A failed refresh is visible

- **WHEN** a periodic re-fetch fails while the page stays open
- **THEN** the page indicates its data may be momentarily stale instead of silently freezing

### Requirement: Never-resolved acquisitions are titled by their request

An acquisition whose metadata never resolved SHALL be titled by what the user asked for — the
artist/title descriptor as given, or a neutral unknown-release label for an id-only request —
in both the master list and the detail heading. A resolving placeholder title SHALL appear only
while resolution is genuinely pending, never as the permanent title of a terminally failed
acquisition.

#### Scenario: A metadata-failed acquisition keeps a meaningful title

- **WHEN** a user views the list or detail of an acquisition whose metadata resolution failed
- **THEN** its title renders from the request as given (or a neutral unknown-release label for an
  id-only request), not a resolving placeholder

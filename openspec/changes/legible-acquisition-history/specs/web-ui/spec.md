# web-ui — delta for legible-acquisition-history

## MODIFIED Requirements

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

## ADDED Requirements

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

### Requirement: The acquisition detail refreshes itself while active

While the displayed acquisition is not terminal, the detail page SHALL periodically re-fetch its
own data and re-render without user action, so the timeline and its in-progress entry track
reality; refreshing SHALL stop once the acquisition is terminal and on leaving the page. The
refresh trigger SHALL sit behind a single swappable seam owned by the page layer, with the
timeline presentation consuming page data only, so a future push-based freshness source replaces
the trigger without touching the presentation. The refresh SHALL reuse the page's existing load
path and SHALL NOT introduce a new wire endpoint.

#### Scenario: An active acquisition's page advances by itself

- **WHEN** a user keeps the detail of an active acquisition open while the acquisition progresses
- **THEN** the timeline gains the new entries and the in-progress entry advances without a manual reload

#### Scenario: A terminal acquisition's page rests

- **WHEN** the displayed acquisition reaches a terminal state
- **THEN** periodic refreshing stops

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

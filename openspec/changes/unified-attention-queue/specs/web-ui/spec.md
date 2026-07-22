## MODIFIED Requirements

### Requirement: Import review resolution

The web UI SHALL let the user resolve a pending import review (matching the importer facade's resolve contract), at parity with the retired `resolve_review` MCP tool. Pending reviews SHALL be listed by the attention queue (see "The attention queue unifies work awaiting a human") rather than by an importer-only listing.

#### Scenario: Resolving a review

- **WHEN** a user resolves a pending review with a valid choice
- **THEN** the importer facade's resolve command is dispatched and the review leaves the attention queue

#### Scenario: Stale resolution is a modeled error

- **WHEN** a user resolves a review that is no longer pending
- **THEN** the UI shows the facade's modeled conflict error and the import's state is unchanged

## ADDED Requirements

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

The web UI SHALL present an acquisition awaiting manual edition selection as requiring the user's action — with a distinct badge tone and an explicit waiting-for-your-choice description — never as generic in-progress work or a bare "(resolving…)" placeholder.

#### Scenario: The list distinguishes an awaiting-selection acquisition

- **GIVEN** the acquisitions list contains an awaiting-selection acquisition and a searching acquisition
- **WHEN** the user views the list
- **THEN** the awaiting-selection row carries a visually distinct action-needed tone and states that an edition choice is awaited, while the searching row remains generic in-progress

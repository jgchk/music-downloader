# web-ui — delta for stalled-work-recovery

## ADDED Requirements

### Requirement: Stalled work tells the truth in the user register

When a module facade reports work stalled, the web UI SHALL say so in the narration register's
own voice — the work is stuck and needs the system's operator — on the acquisition detail page,
the import section of the timeline, and the corresponding list rows, replacing any telling that
implies ordinary progress. The stalled telling SHALL carry no verb for guest sessions and SHALL
NOT expose operator diagnostics in the user register; the determination SHALL come from the
facades' decided stalled flags, never re-derived. A stalled story SHALL remain live (it can
recover), so self-refresh continues. When the stall clears, the telling SHALL return to the
ordinary narration with no residue.

#### Scenario: A stalled import stops claiming progress

- **GIVEN** an import whose facade status reports stalled
- **WHEN** a user views the acquisition's detail page or the pending row
- **THEN** the telling states the work is stuck and needs the system's operator — not an
  in-progress phrase — and offers the user no operator verb

#### Scenario: The stalled telling derives from the decided flag

- **WHEN** the stalled telling is composed
- **THEN** it follows the facade's stalled flag alone, not a status-enum or timing heuristic

#### Scenario: Recovery leaves no residue

- **GIVEN** a stalled import that an operator redrives to completion
- **WHEN** the user next views the story
- **THEN** it reads as ordinary completed narration with no stall telling remaining

## MODIFIED Requirements

### Requirement: The attention queue unifies work awaiting a human

The web UI SHALL present a single attention queue that lists every item across modules currently waiting on a decision the signed-in user can make themselves — at minimum the importer's pending match reviews and the downloader's acquisitions awaiting manual edition selection — as one list ordered longest-waiting first. Operator-only conditions (stalled work awaiting the system's operator) SHALL NOT appear in this queue; they belong to the operations surface (see `web-operations`). Each item SHALL name **the ask** — the decision waiting on the user — in plain, action-oriented language, SHALL be titled by its musical intent where the correlation is available (degrading as the review titling requirement specifies), and SHALL link to the surface where the decision is made. Visible queue text SHALL NOT name the owning module or any architecture noun; a machine-readable module attribute MAY remain on the row for styling and tests. The queue SHALL be composed by the web layer from the module facades' own read models; the composition SHALL NOT introduce a cross-module contract between the bounded contexts. When one module's read fails, the queue SHALL render the other module's items alongside a modeled error for the failed section, not fail as a whole. Any capability that adds a new pause waiting on a user-resolvable decision SHALL surface its pending items in this queue.

#### Scenario: Items from both modules appear as one queue

- **GIVEN** a pending import review and an acquisition awaiting manual edition selection
- **WHEN** the user opens the attention queue
- **THEN** both items appear in one list, longest-waiting first, each naming the decision asked of the user in action-oriented language and linking to its resolution surface

#### Scenario: The queue never names the machinery

- **GIVEN** attention items originating from both modules
- **WHEN** the user reads the queue
- **THEN** no visible text names a module or architecture noun, while each row still carries its machine-readable module attribute

#### Scenario: Resolving an item removes it from the queue

- **GIVEN** an attention queue showing an awaiting-selection acquisition
- **WHEN** the user follows its link and selects an edition
- **THEN** the acquisition proceeds and no longer appears in the attention queue

#### Scenario: One module failing does not empty the queue

- **GIVEN** one module's facade read fails
- **WHEN** the user opens the attention queue
- **THEN** the other module's items are listed and the failed section renders a modeled error message

#### Scenario: Stalled work never enters the queue

- **GIVEN** a stalled import awaiting the system's operator
- **WHEN** any user opens the attention queue
- **THEN** the stalled item is absent — its user-register telling lives on its own pages, and
  its actionable form lives on the operations surface

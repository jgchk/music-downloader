## ADDED Requirements

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

## MODIFIED Requirements

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

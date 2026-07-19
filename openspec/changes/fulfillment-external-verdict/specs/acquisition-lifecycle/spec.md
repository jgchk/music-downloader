## MODIFIED Requirements

### Requirement: A validated, imported download fulfils the acquisition

The system SHALL mark an acquisition as fulfilled once a candidate has passed validation and been imported into the library. Fulfilment SHALL be stable but defeasible: it is the acquisition's resting state and terminal for every existing purpose, but an external validation failure reported for the fulfilled candidate SHALL reject that candidate and revive the acquisition into the existing retry ladder — selecting the next-best candidate, re-searching within bounds, or exhausting — spending the same attempt and search-round budgets as any other rejection, so total activity remains bounded and the acquisition still converges to an absorbing outcome. An acquisition that never receives such a report SHALL rest at fulfilled indefinitely. All other terminal states remain absorbing.

#### Scenario: Successful acquisition

- **GIVEN** an acquisition whose selected candidate passed validation
- **WHEN** the candidate is imported into the library
- **THEN** the acquisition reaches a terminal fulfilled state recording the library location

#### Scenario: An external rejection revives the ladder

- **GIVEN** a fulfilled acquisition whose working set still holds a next-best candidate
- **WHEN** an external validation failure is reported for the fulfilled candidate
- **THEN** the fulfilled candidate is rejected and the next-best candidate is selected for download
- **AND** the rejection is recorded in the acquisition's history with its reasons

#### Scenario: A revival can exhaust

- **GIVEN** a fulfilled acquisition with no remaining candidates and no search budget
- **WHEN** an external validation failure is reported for the fulfilled candidate
- **THEN** the acquisition reaches the absorbing exhausted state

#### Scenario: A mismatched or repeated verdict is ignored

- **GIVEN** a fulfilled acquisition
- **WHEN** an external validation failure names a candidate other than the fulfilled one, or arrives again after a revival already occurred
- **THEN** the report is ignored and the acquisition's state is unchanged

#### Scenario: Absorbing states cannot be revived

- **GIVEN** an exhausted, cancelled, conflicted, or metadata-failed acquisition
- **WHEN** an external validation failure is reported
- **THEN** the report is ignored

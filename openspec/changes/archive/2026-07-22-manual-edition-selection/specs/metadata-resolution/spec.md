## MODIFIED Requirements

### Requirement: A release group with no official edition requests manual selection

The system SHALL, when a release-group request resolves to a group that contains at least one edition but no official edition, neither silently select a non-official edition nor fail the resolution; instead it SHALL yield a manual-selection outcome carrying the group's candidate editions — each presenting the release identifier, title, release date, country, format, and track count — so that a human can choose the edition to acquire. Selecting a candidate edition SHALL resolve to a canonical target for exactly that release, identical to resolving that release by its identifier. This supersedes the prior behavior in which a release group with no official edition failed cleanly as an unresolved metadata-resolution failure.

#### Scenario: No official edition surfaces the editions for manual choice

- **GIVEN** a request naming a release group whose editions are all non-official (e.g. bootleg or promotional)
- **WHEN** the request is resolved
- **THEN** the system yields a manual-selection outcome listing the group's candidate editions with their identifying metadata
- **AND** it does not produce a target and does not terminate with a metadata-resolution failure

#### Scenario: Choosing a candidate edition resolves it

- **GIVEN** a manual-selection outcome listing candidate editions for a release group
- **WHEN** a caller selects one candidate edition by its release identifier
- **THEN** the system produces a canonical target for exactly that release

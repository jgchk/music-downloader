## ADDED Requirements

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

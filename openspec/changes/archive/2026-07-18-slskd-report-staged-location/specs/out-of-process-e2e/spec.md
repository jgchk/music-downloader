## MODIFIED Requirements

### Requirement: The HTTP acquisition flow is verified end to end

The tier SHALL verify, over HTTP, that an acquisition submitted to the running image is driven by the reactor through to a terminal state and is observable through the read APIs.

#### Scenario: Acquisition fulfilled over HTTP

- **WHEN** a client submits an acquisition to the running container over HTTP and the stubs return a matching, downloadable candidate
- **THEN** polling the acquisition's status over HTTP eventually reports a fulfilled terminal state with its library location

#### Scenario: Real bytes pass real validation and import

- **GIVEN** the source stub reports a completed download's on-disk location (as the real source does), and the harness seeds the fixture at exactly that reported location, NOT at a location the adapter recomputes for itself
- **WHEN** the acquisition reaches its staged file
- **THEN** the real ffmpeg probe decodes it and the real filesystem adapter imports it, rather than either step being stubbed or bypassed
- **AND** the tier therefore exercises the adapter's resolution of the source-reported location, so a regression that reintroduced a recomputed or mismatched location would fail the tier

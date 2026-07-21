## MODIFIED Requirements

### Requirement: Verification runs against the real built image over HTTP

The out-of-process E2E tier SHALL exercise the same Docker image that is published, running as a real process, driven across the process boundary over the web interface's HTTP endpoints on a real network socket, with both modules' durable reactors and the cross-module subscriptions running and events persisted to each module's on-disk SQLite database file (not `:memory:`). It SHALL NOT substitute, mock, or bypass the composition root, the web interface transport, the reactors, the subscription seam, the on-disk event stores, or any outbound adapter's own code.

#### Scenario: Same artifact that ships is what is verified

- **WHEN** the tier runs in CI
- **THEN** it targets the image produced by the pipeline's build step, unmodified, rather than a rebuilt or test-only variant

#### Scenario: HTTP is exercised over a real socket

- **WHEN** the tier submits and reads an acquisition through the web interface's endpoints
- **THEN** requests cross a real TCP socket to the running container's listener, not an in-process injection

#### Scenario: The stores are durable, not in-memory

- **WHEN** the container under test processes an acquisition through to import
- **THEN** the downloader's and the importer's events are written to their two on-disk SQLite database files, exercising the real schemas and file-backed stores

### Requirement: External systems are stubbed over HTTP for determinism

The tier SHALL replace only the outermost third-party network systems (slskd and MusicBrainz) with HTTP stubs served from the test harness network, configured via the application's existing base-URL environment seams. The application's real adapter HTTP clients, polling loops, response parsers, and the importer's real beets bridge (running inside the image) SHALL run unmodified. The tier SHALL NOT depend on any live third-party system, so that a third-party outage cannot fail the tier.

#### Scenario: Adapter code runs against canned responses

- **WHEN** the application searches or downloads during the tier
- **THEN** its real slskd and MusicBrainz adapters issue real HTTP requests to the stubs and parse the canned wire-shaped responses

#### Scenario: No live third-party dependency

- **WHEN** the tier runs while slskd or MusicBrainz is unreachable on the public internet
- **THEN** the tier still runs and its result is unaffected, because it never contacts them

### Requirement: The HTTP acquisition flow is verified end to end

The tier SHALL verify, over the web interface, that an acquisition submitted to the running image is driven through the full product loop: the downloader's reactor takes it to fulfilment, the cross-module subscription hands it to the importer, and the import reaches a terminal outcome observable through the interface — proving the seam works across a real process lifetime, not only in-process tests.

#### Scenario: Acquisition fulfilled and imported end to end

- **WHEN** a client submits an acquisition to the running container and the stubs return a matching, downloadable candidate
- **THEN** polling its status eventually reports fulfilment, and the importer's subscription drives the staged files through import to a terminal outcome observable over the interface

#### Scenario: Real bytes pass real validation and import

- **GIVEN** the source stub reports a completed download's on-disk location (as the real source does), and the harness seeds the fixture at exactly that reported location, NOT at a location the adapter recomputes for itself
- **WHEN** the acquisition reaches its staged file
- **THEN** the real ffmpeg probe decodes it and the real filesystem adapter deposits it, rather than either step being stubbed or bypassed
- **AND** the tier therefore exercises the adapter's resolution of the source-reported location, so a regression that reintroduced a recomputed or mismatched location would fail the tier

## ADDED Requirements

### Requirement: Verification runs against the real built image over HTTP

The out-of-process E2E tier SHALL exercise the same Docker image that is published, running as a real process, driven across the process boundary over HTTP on a real network socket, with the durable reactor running and events persisted to an on-disk SQLite database (not `:memory:`). It SHALL NOT substitute, mock, or bypass the composition root, the HTTP interface transport, the reactor, the on-disk event store, or any outbound adapter's own code.

#### Scenario: Same artifact that ships is what is verified

- **WHEN** the tier runs in CI
- **THEN** it targets the image produced by the pipeline's build step, unmodified, rather than a rebuilt or test-only variant

#### Scenario: HTTP is exercised over a real socket

- **WHEN** the tier submits and reads an acquisition over HTTP
- **THEN** requests cross a real TCP socket to the running container's listener, not an in-process injection

#### Scenario: The store is durable, not in-memory

- **WHEN** the container under test processes an acquisition
- **THEN** its events are written to an on-disk SQLite database file, exercising the real schema and file-backed store

### Requirement: External systems are stubbed over HTTP for determinism

The tier SHALL replace only the outermost third-party systems (slskd and MusicBrainz) with HTTP stubs served from the test harness network, configured via the application's existing `SLSKD_BASE_URL` and `MUSICBRAINZ_BASE_URL` environment seams. The application's real adapter HTTP clients, polling loops, and response parsers SHALL run unmodified against the stubs. The tier SHALL NOT depend on any live third-party system, so that a third-party outage cannot fail the tier.

#### Scenario: Adapter code runs against canned responses

- **WHEN** the application searches or downloads during the tier
- **THEN** its real slskd and MusicBrainz adapters issue real HTTP requests to the stubs and parse the canned wire-shaped responses

#### Scenario: No live third-party dependency

- **WHEN** the tier runs while slskd or MusicBrainz is unreachable on the public internet
- **THEN** the tier still runs and its result is unaffected, because it never contacts them

### Requirement: The HTTP acquisition flow is verified end to end

The tier SHALL verify, over HTTP, that an acquisition submitted to the running image is driven by the reactor through to a terminal state and is observable through the read APIs.

#### Scenario: Acquisition fulfilled over HTTP

- **WHEN** a client submits an acquisition to the running container over HTTP and the stubs return a matching, downloadable candidate
- **THEN** polling the acquisition's status over HTTP eventually reports a fulfilled terminal state with its library location

#### Scenario: Real bytes pass real validation and import

- **WHEN** the acquisition reaches its staged file (a real audio fixture on the shared staging volume)
- **THEN** the real ffmpeg probe decodes it and the real filesystem adapter imports it, rather than either step being stubbed or bypassed

### Requirement: The tier gates publish in the pipeline

The tier SHALL run in CI after the image build step and before the publish step, and publishing SHALL be conditional on the tier passing.

#### Scenario: Failing tier blocks publish

- **WHEN** the tier fails against a freshly built image
- **THEN** the pipeline does not publish that image

#### Scenario: Passing tier permits publish

- **WHEN** the tier passes against a freshly built image
- **THEN** the pipeline proceeds to publish that image

### Requirement: The tier is isolated from the unit coverage gate

The tier SHALL run as a separate suite from the unit `vitest run`, so that its files are neither required by nor counted against the project's 100% unit-coverage threshold.

#### Scenario: Coverage gate excludes the tier

- **WHEN** the unit coverage gate runs
- **THEN** the out-of-process E2E suite is not part of that run and does not affect its coverage measurement

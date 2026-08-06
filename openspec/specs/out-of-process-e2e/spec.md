# out-of-process-e2e Specification

## Purpose

Define an out-of-process end-to-end verification tier that exercises the real published Docker image as a running process, driven over the web interface's HTTP endpoints, with only the outermost third-party systems stubbed — proving the full product loop, from submitted intent through the cross-module seam to a terminal imported outcome, works across a real process lifetime before the image is published.

## Requirements
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

The tier SHALL replace only the outermost third-party network systems (slskd, MusicBrainz, and plex.tv) with HTTP stubs served from the test harness network, configured via the application's existing base-URL environment seams. The application's real adapter HTTP clients, polling loops, response parsers, and the importer's real beets bridge (running inside the image) SHALL run unmodified. The tier SHALL NOT depend on any live third-party system, so that a third-party outage cannot fail the tier.

#### Scenario: Adapter code runs against canned responses

- **WHEN** the application searches or downloads during the tier
- **THEN** its real slskd and MusicBrainz adapters issue real HTTP requests to the stubs and parse the canned wire-shaped responses

#### Scenario: No live third-party dependency

- **WHEN** the tier runs while slskd, MusicBrainz, or plex.tv is unreachable on the public internet
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

### Requirement: A real-browser interface phase runs against the same image

The tier SHALL include a browser-driven phase that exercises the web interface of the same built image the tier's other phases run — a real browser driving pages over the container's HTTP listener on a real socket — covering at minimum: the product navigation renders, an acquisition can be submitted and appears in the listing, a rejected submission re-renders the form with its modeled error, a retrying acquisition can be cancelled from its detail page, and the review queue serves its empty state. The phase SHALL be orchestrated by the tier's harness (which owns container lifecycle for all phases); the browser runner SHALL NOT build, boot, or own the application process in CI.

#### Scenario: Browser drives the published artifact, not a bespoke boot

- **WHEN** the tier runs in CI
- **THEN** the browser phase targets the running container built from the image to be published, over its HTTP port, rather than an application booted outside the image

#### Scenario: Browser phase failure blocks publish

- **WHEN** the browser phase fails against a freshly built image
- **THEN** the tier fails and the pipeline does not publish that image

### Requirement: The browser phase proves degraded boot with third parties unreachable

The browser phase SHALL run against an application instance whose third-party base URLs point at a local endpoint the application's HTTP client refuses deterministically (a WHATWG fetch bad port — the client rejects the request before any network I/O), so the image is proven to boot, serve pages, and accept user actions while both outermost third parties are unreachable, and so acquisitions remain in retry — keeping user-shaped cancellation observable. The phase SHALL NOT depend on the tier's HTTP stubs or on any stub's unmatched-request behavior.

#### Scenario: Image serves while third parties are down

- **WHEN** the browser phase's application instance starts with slskd and MusicBrainz base URLs pointing at a deterministically-refused endpoint
- **THEN** the container becomes ready and serves the interface's pages

#### Scenario: Cancellation is exercised against a retrying acquisition

- **WHEN** an acquisition is submitted during the browser phase
- **THEN** it remains retrying (third parties unreachable) long enough for the browser to cancel it from its detail page and observe the Cancelled status

### Requirement: The browser phase authenticates by minting sessions with the production codec

The browser phase SHALL authenticate by having the harness sign a session cookie using the application's own production session codec (imported, not reimplemented) with the harness-supplied session secret, installed via the browser runner's storage-state mechanism. The tier SHALL NOT rely on any auth-disabling or strategy-selecting configuration of the image — the gate in the tested image runs exactly as shipped.

#### Scenario: Journeys run as an authenticated user

- **WHEN** the browser phase drives the gated interface journeys
- **THEN** it does so with a harness-minted cookie that the image's unmodified gate verifies, and the journeys behave as for any logged-in user

#### Scenario: The minting helper cannot drift from production

- **WHEN** the production session codec's signing scheme changes
- **THEN** the harness helper changes with it by construction, because it imports the production codec rather than duplicating it

### Requirement: The gate is proven from outside the image

The browser phase SHALL prove the access gate end-to-end against the shipped image: an unauthenticated browser and a browser carrying an invalid cookie both land on the login page, and the health endpoint answers without credentials.

#### Scenario: No cookie lands on login

- **WHEN** a browser with no session cookie requests a gated page of the running container
- **THEN** it is redirected to the login page and no gated content renders

#### Scenario: Garbage cookie lands on login

- **WHEN** a browser carrying a malformed or wrongly-signed session cookie requests a gated page
- **THEN** it is redirected to the login page

#### Scenario: Health needs no session

- **WHEN** the harness probes the health endpoint with no cookie
- **THEN** it answers as before the gate existed

### Requirement: The login journey is walked against the plex.tv stub

The tier SHALL include one browser journey that exercises the application's real login routes against the plex.tv stub: submitting the login form (PIN creation against the stub), following the redirect contract in place of the hosted Plex page, and completing the callback into an issued session — plus the denial path for an account the stub reports as not sharing the configured server.

#### Scenario: Stubbed login issues a real session

- **WHEN** the journey completes the login flow with the stub approving the PIN and reporting server membership
- **THEN** the application's own callback issues a session cookie and the browser reaches the gated interface

#### Scenario: Stubbed denial stays outside

- **WHEN** the journey completes the flow with the stub reporting an account without the configured server
- **THEN** the login page shows the denial and gated pages remain unreachable

### Requirement: The review-resolution revival loop is proven end to end

The e2e tier SHALL include an isolated phase that drives a human review resolution over the web
interface's HTTP endpoints against the real image and witnesses the full cross-context
consequence: a genuinely low-confidence import (real beets scoring a seeded fixture into the
band between auto-apply and no-match) queues a review; resolving it as the unusable-delivery
rejection publishes the verdict; the downloader consumes it, revives the hunt, and delivers a
second candidate; and the story completes into the library. The phase SHALL assert the review
actually queued before resolving — so a metadata-scoring shift under a future beets version
fails the phase loudly at the setup assertion rather than silently downgrading the scenario —
and SHALL assert the first delivery's rejection left no partial state behind (the rejected
files are gone from staging per the rejection's contract). The phase SHALL drive resolution
through the same HTTP surface a user submits, not a facade or store back-door.

#### Scenario: A rejected delivery revives the hunt and completes

- **GIVEN** the image running with a seeded source whose best match scores into the review band
  and a stub source offering a second, better candidate
- **WHEN** the phase confirms the review queued, then resolves it as reject-unusable-delivery
  over HTTP
- **THEN** the downloader resumes the hunt without a new submission, the second candidate is
  delivered and imported, the story reaches its ordinary completed outcome, and the review queue
  is empty

#### Scenario: The setup asserts its own premise

- **WHEN** the seeded fixture no longer scores into the review band (for example, after a beets
  version change)
- **THEN** the phase fails at its explicit review-queued assertion, naming the premise that
  broke, rather than passing vacuously or failing obscurely downstream

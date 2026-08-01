## MODIFIED Requirements

### Requirement: External systems are stubbed over HTTP for determinism

The tier SHALL replace only the outermost third-party network systems (slskd, MusicBrainz, and plex.tv) with HTTP stubs served from the test harness network, configured via the application's existing base-URL environment seams. The application's real adapter HTTP clients, polling loops, response parsers, and the importer's real beets bridge (running inside the image) SHALL run unmodified. The tier SHALL NOT depend on any live third-party system, so that a third-party outage cannot fail the tier.

#### Scenario: Adapter code runs against canned responses

- **WHEN** the application searches or downloads during the tier
- **THEN** its real slskd and MusicBrainz adapters issue real HTTP requests to the stubs and parse the canned wire-shaped responses

#### Scenario: No live third-party dependency

- **WHEN** the tier runs while slskd, MusicBrainz, or plex.tv is unreachable on the public internet
- **THEN** the tier still runs and its result is unaffected, because it never contacts them

## ADDED Requirements

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

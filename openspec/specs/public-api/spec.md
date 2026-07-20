# public-api Specification

## Purpose

Define the public surface for acquisitions over HTTP and MCP: asynchronous submission, observable status and progress, cancellation, versioned additive evolution, and a single shared schema source that keeps HTTP validation, OpenAPI, and MCP tool schemas from drifting.
## Requirements
### Requirement: Acquisitions are submitted asynchronously
The system SHALL accept an acquisition submission and return immediately with the acquisition's identifier and a location to observe its status, rather than blocking until the acquisition completes.

#### Scenario: Submission is accepted over HTTP
- **WHEN** a caller submits an acquisition request to the HTTP API
- **THEN** the API responds with an accepted status, the acquisition identifier, and a status location

#### Scenario: Submission is accepted over MCP
- **WHEN** a caller invokes the submit-acquisition MCP tool
- **THEN** the tool returns the acquisition identifier

### Requirement: Acquisition status and progress are observable
The system SHALL let callers query an acquisition's current state and history, and its live download progress, over both interfaces.

#### Scenario: Status is queryable over HTTP
- **GIVEN** a submitted acquisition
- **WHEN** the caller requests its status
- **THEN** the API returns the current state, current candidate, and attempt history

#### Scenario: Acquisitions are exposed as MCP resources
- **GIVEN** a submitted acquisition
- **WHEN** an MCP client reads the acquisition resource
- **THEN** its current status is returned

### Requirement: Acquisitions can be cancelled over the interfaces
The system SHALL allow a non-terminal acquisition to be cancelled through both the HTTP API and MCP.

#### Scenario: Cancellation over HTTP
- **GIVEN** a non-terminal acquisition
- **WHEN** the caller cancels it via the HTTP API
- **THEN** the API accepts the cancellation and the acquisition stops doing further work

### Requirement: Public interfaces are versioned and additive
The system SHALL expose the HTTP API under a version prefix and evolve it additively, never changing or removing existing fields or endpoints within a version; breaking changes require a new version while the prior version keeps working.

#### Scenario: Version prefix is present
- **WHEN** a caller uses the HTTP API
- **THEN** all endpoints are served under a version prefix such as /api/v1

#### Scenario: A breaking change to a shipped version is prevented
- **GIVEN** a shipped API version
- **WHEN** a change would alter or remove an existing field or endpoint within that version
- **THEN** the contract test fails and the change cannot be released under the same version

### Requirement: Interface contracts derive from a single schema source
The system SHALL derive HTTP request validation, the published OpenAPI document, and the MCP tool schemas from one shared schema definition, so the three cannot drift apart.

#### Scenario: One schema drives all surfaces
- **GIVEN** a shared schema for a request type
- **WHEN** the HTTP validation, OpenAPI document, and MCP tool schema are produced
- **THEN** all three reflect that same schema definition

### Requirement: MCP is served over streamable HTTP by the application's HTTP server
The system SHALL expose the MCP server over the streamable HTTP transport at a dedicated endpoint on the same HTTP server (same process and port) that serves the HTTP API, and SHALL NOT offer a stdio MCP transport. All MCP clients therefore connect to the one running instance, so acquisitions are shared across HTTP and MCP callers by construction.

#### Scenario: An MCP client connects over streamable HTTP
- **WHEN** an MCP client sends an initialize request to the MCP endpoint of the running HTTP server
- **THEN** the protocol handshake completes over streamable HTTP and the client can invoke tools and read resources

#### Scenario: HTTP and MCP callers operate on the same acquisitions
- **GIVEN** an acquisition submitted through the HTTP API
- **WHEN** an MCP client connected to the same server cancels that acquisition by id
- **THEN** the cancellation applies to that same acquisition

#### Scenario: Stdio transport is not offered
- **WHEN** the application starts
- **THEN** MCP is reachable only through the HTTP server's MCP endpoint, and the process's stdio streams carry no MCP protocol traffic

#### Scenario: Non-POST methods on the MCP endpoint are rejected per protocol
- **WHEN** a client sends a GET request to the MCP endpoint (no session-based streaming is offered)
- **THEN** the server responds with a method-not-allowed JSON-RPC error as prescribed by the streamable HTTP transport specification

### Requirement: Interfaces report the application release version
The system SHALL read its release version from package.json at runtime and report it as the OpenAPI document's `info.version` and as the MCP server's advertised version. The breaking-change contract snapshot SHALL be insensitive to this value, and the API contract version (the `/api/v1` path prefix) SHALL remain independent of the release version.

#### Scenario: OpenAPI reports the release version
- **GIVEN** the application is built from a commit whose package.json version is X.Y.Z
- **WHEN** the OpenAPI document is served
- **THEN** its `info.version` is X.Y.Z

#### Scenario: MCP reports the release version
- **WHEN** an MCP client initializes against the server
- **THEN** the advertised server version equals the package.json version

#### Scenario: A release does not trip the breaking-change contract test
- **GIVEN** a version bump with no changes to endpoints, fields, or schemas
- **WHEN** the OpenAPI snapshot contract test runs
- **THEN** it passes, because `info.version` is normalized before comparison

### Requirement: External verdicts are received over a signed, idempotent webhook endpoint
The system SHALL expose an inbound webhook endpoint that accepts external validation verdicts for delivered acquisitions: deliveries are verified against a configured shared secret (signature and timestamp) and deduplicated by delivery id; payloads are read tolerantly — only the acquisition id, candidate identity, verdict, and optional reasons this domain needs, ignoring unknown fields — and translated at the boundary into the native external-validation command. Redelivered or stale verdicts SHALL converge without error. With no receiver secret configured, the endpoint SHALL NOT be registered and the system behaves exactly as today.

#### Scenario: A signed rejection verdict revives an acquisition
- **GIVEN** a fulfilled acquisition and a configured receiver secret
- **WHEN** a correctly signed verdict delivery rejects the fulfilled candidate
- **THEN** the acquisition revives into the retry ladder and the endpoint acknowledges the delivery

#### Scenario: An unsigned delivery is rejected before parsing
- **WHEN** a delivery arrives with a missing or invalid signature
- **THEN** it is rejected without any command being issued

#### Scenario: A redelivered verdict converges
- **GIVEN** a verdict delivery already processed
- **WHEN** the same delivery arrives again
- **THEN** it is acknowledged and the acquisition's state is unchanged

#### Scenario: Unknown payload fields are ignored
- **GIVEN** a sender whose payload carries fields this system does not use
- **WHEN** the delivery is processed
- **THEN** the extra fields are ignored and the verdict is handled normally

### Requirement: The MCP endpoint is an OAuth 2.1 Resource Server when configured

The system SHALL, when an OAuth issuer and canonical resource identifier are configured, protect the MCP endpoint as an OAuth 2.1 Resource Server per the MCP `2025-06-18` authorization spec: it SHALL publish OAuth 2.0 Protected Resource Metadata (RFC 9728) advertising the configured resource identifier and authorization server, and it SHALL require and validate a bearer access token on every MCP request. With no issuer configured, the MCP endpoint SHALL remain unauthenticated, the protected-resource-metadata route SHALL NOT be registered, and the system behaves exactly as today. When an issuer is configured without a resource identifier, startup SHALL fail loudly rather than run without audience validation.

#### Scenario: Protected resource metadata is published when configured

- **GIVEN** a configured OAuth issuer and resource identifier
- **WHEN** a client requests the protected-resource-metadata document at `/.well-known/oauth-protected-resource`
- **THEN** the system returns JSON naming the configured resource identifier, the configured authorization server, and header as a supported bearer method

#### Scenario: A valid bearer token reaches the MCP tools

- **GIVEN** a configured Resource Server and an access token whose signature verifies against the issuer's keys, whose issuer matches, which is unexpired, and whose audience includes this server's resource identifier
- **WHEN** the client calls the MCP endpoint with that token in the Authorization header
- **THEN** the request is admitted and the MCP tool or resource behaves exactly as it does unauthenticated

#### Scenario: A missing or invalid token is challenged

- **GIVEN** a configured Resource Server
- **WHEN** an MCP request arrives with no bearer token, or a token that is malformed, unverifiable, expired, from the wrong issuer, or whose audience does not include this server's resource identifier
- **THEN** the system responds 401 with a `WWW-Authenticate: Bearer` challenge whose `resource_metadata` points at this server's protected-resource-metadata URL, and no MCP tool runs

#### Scenario: Unconfigured, the MCP endpoint stays open

- **GIVEN** no OAuth issuer is configured
- **WHEN** a client calls the MCP endpoint without any token
- **THEN** the request is admitted as before and the protected-resource-metadata route does not exist

#### Scenario: A half-configured Resource Server refuses to start

- **GIVEN** an OAuth issuer is configured but no resource identifier
- **WHEN** the system starts
- **THEN** startup fails with a configuration error rather than serving MCP without audience validation


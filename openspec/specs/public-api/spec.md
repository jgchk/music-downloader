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

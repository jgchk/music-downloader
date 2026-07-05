# public-api Delta: mcp-streamable-http-transport

## ADDED Requirements

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

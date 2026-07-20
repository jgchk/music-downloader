## ADDED Requirements

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

# public-api Specification (delta)

## ADDED Requirements

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

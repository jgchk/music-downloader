## REMOVED Requirements

### Requirement: Acquisitions are submitted asynchronously
**Reason**: The standalone HTTP API and MCP interface are retired: nothing external consumes them, and hosted models refuse music-download MCP tools on content grounds regardless of transport or auth. The interface surface moves to the web BFF over wire-shaped module facades.
**Migration**: Asynchronous submission is preserved by the `web-ui` capability (submission returns immediately with the acquisition identifier and observable progress) over the downloader module's facade (`module-architecture`), which remains the transport-binding point if an HTTP API is ever reintroduced.

### Requirement: Acquisition status and progress are observable
**Reason**: HTTP API and MCP retired with the interface consolidation; no external consumers exist.
**Migration**: Status, history, and live progress observation are preserved by the `web-ui` capability, reading the module facade's queries.

### Requirement: Acquisitions can be cancelled over the interfaces
**Reason**: HTTP API and MCP retired with the interface consolidation.
**Migration**: Cancellation of non-terminal acquisitions is preserved as a `web-ui` flow dispatching the facade's cancel command.

### Requirement: Public interfaces are versioned and additive
**Reason**: With zero external consumers, a frozen public wire contract inverts the purpose of the api-compatibility rule (it protects consumers; there are none). The BFF ships atomically with its frontend and needs no cross-version contract.
**Migration**: Compatibility discipline moves down a level: module facades and the cross-module event contract (`module-architecture`, `cross-module-delivery`) are the versioned seams. A future public HTTP API would be a new capability binding the facades to a versioned transport.

### Requirement: Interface contracts derive from a single schema source
**Reason**: The three surfaces this requirement kept from drifting (HTTP validation, OpenAPI, MCP tool schemas) no longer exist.
**Migration**: Single-source schema discipline persists at the facade boundary: facade DTOs are zod-defined once and consumed by every interface package (`module-architecture`).

### Requirement: MCP is served over streamable HTTP by the application's HTTP server
**Reason**: MCP is removed entirely — experimentation showed hosted models refuse music-download tools on content grounds, making the endpoint a doorway models won't walk through.
**Migration**: None required; no consumers remain. Re-adding MCP later is a transport binding over the wire-shaped facades.

### Requirement: Interfaces report the application release version
**Reason**: The OpenAPI document and MCP server that reported the release version are removed with their interfaces.
**Migration**: The release version remains available to the web interface from package.json for display/diagnostics; no wire contract depends on it.

### Requirement: External verdicts are received over a signed, idempotent webhook endpoint
**Reason**: The verdict sender (the importer) now lives in the same process; the network hop, shared-secret signing, and webhook delivery dedupe protect a boundary that no longer exists.
**Migration**: Verdict intake moves to the cross-module subscription seam — see the ADDED requirement in `library-import` and the `cross-module-delivery` capability. Tolerant reading, ACL translation into the native external-validation command, and idempotent convergence on redelivery are preserved unchanged.

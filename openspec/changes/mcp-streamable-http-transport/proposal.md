# Proposal: mcp-streamable-http-transport

## Why

The MCP server currently connects over stdio (`StdioServerTransport`), which forces the MCP client to be the parent process of the whole application. Running the app standalone for HTTP while an MCP client spawns its own instance creates a second process that either crashes on a port conflict or races the first: two reactors share one checkpoint row and can double-fire effects, each process's projections are frozen snapshots of the other's activity, and a cancellation appended by one process is never reacted to by the other. Serving MCP over the streamable HTTP transport on the existing HTTP server makes "one server, many clients" the natural deployment shape and dissolves the two-process trap entirely.

## What Changes

- The MCP server is exposed over the **streamable HTTP transport** at an endpoint on the existing Fastify HTTP server (same process, same port).
- **BREAKING**: The stdio transport is **removed**. MCP clients must reconfigure from spawn-the-process (`command`/`args`) to a URL-based connection. This break to the MCP connection contract is explicitly accepted for this change (per-change exemption from the no-breaking-change policy, approved by the project owner); the MCP tool and resource contracts themselves are unchanged.
- The composition root wires the MCP server into the HTTP app instead of connecting a stdio transport; graceful shutdown drains MCP sessions along with in-flight HTTP requests.
- E2E coverage exercises MCP over HTTP against the running server (previously not exercisable without owning the process's stdio).

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `public-api`: MCP access changes from stdio (client-spawned process) to streamable HTTP served by the application's HTTP server — a new transport requirement, plus removal of the stdio connection mode. Tool/resource semantics and schemas are unchanged.

## Impact

- **Code**: `src/composition/index.ts` (drop `StdioServerTransport`, mount MCP on Fastify), `src/interfaces/mcp/server.ts` (transport wiring/session handling), `src/interfaces/http/app.ts` (new MCP endpoint), and their tests.
- **Dependencies**: uses `StreamableHTTPServerTransport` from the already-present `@modelcontextprotocol/sdk`; may need a small Fastify raw-request bridge.
- **Consumers**: any existing MCP client configuration (stdio `command`-style entries) must be migrated to a URL-based (streamable HTTP) configuration. There are no known external consumers beyond the developer's own clients.
- **Contract tests / policy**: the no-breaking-change gate does not apply to this transport change (explicit exemption); HTTP API v1 remains additive and untouched.
- **Docs/specs**: `public-api` spec gains a transport requirement; deployment/run docs change (one process serves HTTP + MCP).

# Design: mcp-streamable-http-transport

## Context

The composition root currently connects the MCP `Server` to a `StdioServerTransport` (`src/composition/index.ts`), while the HTTP API listens on Fastify in the same process. Stdio forces the MCP client to be the parent of the whole application process, which creates the two-process trap described in the proposal (checkpoint races between reactors, stale projections, unreacted cancellations). It also conflicts latently with our logging: pino writes structured logs to stdout by default, the same stream stdio MCP uses for JSON-RPC frames.

The MCP inbound adapter itself (`src/interfaces/mcp/server.ts`) is transport-agnostic — it builds a `Server` with tool/resource handlers over the shared use-cases. Only the transport wiring changes.

The pinned SDK (`@modelcontextprotocol/sdk` ^1.29.0) ships `StreamableHTTPServerTransport` (`server/streamableHttp.js`) with `handleRequest(req, res, parsedBody)` and a `sessionIdGenerator` option that selects stateful (sessions via `Mcp-Session-Id`) or stateless (`undefined`) operation.

## Goals / Non-Goals

**Goals:**

- Serve MCP over streamable HTTP from the existing Fastify server — one process, one port, many concurrent clients.
- Remove the stdio transport entirely (accepted breaking change to the connection contract).
- Keep tool/resource semantics and the shared zod-derived schemas byte-identical.
- Make MCP exercisable by the out-of-process E2E tier against the running server.

**Non-Goals:**

- No auth on the MCP endpoint (matches the HTTP API, which is also unauthenticated; the server binds a configured host, localhost-oriented deployment).
- No server-initiated notifications, subscriptions, or SSE resumability — nothing in the current adapter pushes to clients.
- No change to acquisition behavior (the cancel/AbortSignal gap is a separate change).
- No multi-node scaling concerns (single-process SQLite app).

## Decisions

### D1: Stateless transport mode (`sessionIdGenerator: undefined`)

A fresh `Server` + `StreamableHTTPServerTransport` pair is constructed per incoming request, connected, and handed the request; nothing is retained between requests.

- **Why**: Our MCP surface is strictly request/response — tools that submit/cancel and resources that read projections. There is no server-push, so sessions buy nothing and cost a session registry, expiry, and shutdown draining. Stateless mode also sidesteps JSON-RPC request-ID collision concerns across clients, since no transport instance is shared. `buildMcpServer` is a cheap closure over `UseCaseDeps`; per-request construction is negligible next to the SQLite reads it fronts.
- **Alternative considered**: stateful sessions (`sessionIdGenerator: () => randomUUID()` plus a transport map keyed by `Mcp-Session-Id`, GET SSE streams, DELETE teardown). Rejected: pure overhead until we want server-initiated messages; can be introduced later without breaking clients (the protocol negotiates it).

### D2: Mount at `POST /mcp` on the existing Fastify app, bridged via raw req/res

`buildHttpApp` (or a small registration function it calls) gains an `/mcp` route. The handler calls `reply.hijack()` and then `transport.handleRequest(request.raw, reply.raw, request.body)` — Fastify has already parsed the JSON body, so it is passed as `parsedBody`. `GET /mcp` and `DELETE /mcp` are also routed to the transport so it can answer them with the spec-correct method-not-allowed JSON-RPC errors in stateless mode.

- **Why hijack**: the transport writes status, headers, and body directly to the underlying `ServerResponse`; hijacking tells Fastify not to compete for the socket.
- **Why `/mcp`, not `/api/v1/mcp`**: the `/api/v1` prefix versions the REST resource contract. MCP carries its own protocol versioning (negotiated at initialize) and its tool schemas are already governed by the shared contracts; nesting it under the REST version would wrongly couple the two lifecycles.

### D3: The MCP adapter exposes a builder, the composition root stops touching transports

`src/interfaces/mcp/server.ts` keeps `buildMcpServer(deps, logger)` unchanged and gains the route-registration piece (e.g. `registerMcpEndpoint(app, deps, logger)`) so the transport bridge lives with the MCP adapter, not in `app.ts` or the composition root. The composition root drops the `StdioServerTransport` import and the `mcpServer.connect(...)` call; shutdown no longer closes an MCP server (per-request transports die with their responses; `httpApp.close()` drains in-flight requests as before).

- **Why**: preserves the layering — interfaces own their protocol details; composition only wires. It also keeps `app.ts` free of MCP knowledge beyond one registration call.

### D4: Origin/DNS-rebinding posture stays with host binding

The transport's DNS-rebinding protection stays off; the deployment posture remains "bind `config.host`, default localhost" — same trust model as the unauthenticated HTTP API. This is recorded as a risk below rather than solved here.

### D5: Testing strategy

- **Unit/integration (vitest, in-process)**: drive `POST /mcp` through `app.inject()` with real JSON-RPC payloads (`initialize`, `tools/list`, `tools/call`, `resources/read`) and assert on the JSON-RPC results; assert `GET /mcp` answers 405. This keeps 100% coverage of the new bridge code without sockets.
- **E2E (out-of-process)**: extend `test/e2e/` to connect an SDK `StreamableHTTPClientTransport` client to the live server and run a submit → status-read round-trip, proving HTTP and MCP interoperate on one acquisition — the exact scenario stdio made impossible.

## Risks / Trade-offs

- **[Breaking change] Existing stdio client configs stop working with no overlap window** → Accepted explicitly by the owner; migration is a one-line client config change (spawn command → `http://host:port/mcp` URL). Called out in the proposal and release notes.
- **[Unauthenticated network-reachable MCP endpoint] If `HOST` is set to a non-loopback interface, anyone who can reach the port can submit/cancel acquisitions** → Same exposure the HTTP API already has; document that MCP inherits the HTTP trust model. Origin validation/auth can be layered on later without a transport change.
- **[Per-request server construction] Handler closures are rebuilt per request** → Negligible cost (object construction, no I/O); revisit only if profiling ever says otherwise.
- **[Fastify raw-response bridging] `reply.hijack()` bypasses Fastify's reply lifecycle (logging hooks, error mapping) for this route** → The transport writes protocol-correct errors itself; request-level logging still fires via `onRequest`-phase hooks. Covered by the injected-request tests.
- **[SSE surface unused but reachable] Streamable HTTP permits SSE responses; stateless mode never opens long-lived streams** → GET is answered with method-not-allowed; nothing to drain on shutdown.

## Migration Plan

1. Land the endpoint + stdio removal in one change (no dual-transport window — stdio is actively harmful here).
2. Update the developer's MCP client entries from `command: node dist/...` to `url: http://localhost:<port>/mcp` (streamable HTTP).
3. Rollback: revert the change; stdio wiring returns.

## Open Questions

_None — resolved during exploration: stateless mode, `/mcp` path, and dropping stdio without a deprecation window were all confirmed with the owner._

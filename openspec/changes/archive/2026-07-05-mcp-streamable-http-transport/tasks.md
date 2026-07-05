# Tasks: mcp-streamable-http-transport

Test-first throughout: each task's failing test lands before its production line (see `docs/development/testing.md`).

## 1. MCP endpoint on the Fastify app

- [x] 1.1 Write tests for `registerMcpEndpoint` in `src/interfaces/mcp/server.test.ts`: `initialize` handshake, `tools/list` with the shared zod-derived schemas, `tools/call` submit+cancel round-trip, and `resources/list`/`resources/read` of the projection-backed resources. _Deviation: driven through a real in-process listener (`app.listen({ port: 0 })`) + a real `StreamableHTTPClientTransport` client rather than `app.inject()` — the transport's Node↔Web conversion doesn't work with light-my-request's mock req/res. Still in-process, so it counts for coverage._
- [x] 1.2 Implement `registerMcpEndpoint(app, deps, logger)` in `src/interfaces/mcp/server.ts`: per-request `buildMcpServer` + `StreamableHTTPServerTransport` (`sessionIdGenerator: undefined`), `reply.hijack()`, `transport.handleRequest(request.raw, reply.raw, request.body)` (design D1–D3).
- [x] 1.3 Test non-POST handling: `GET /mcp` returns a method-not-allowed JSON-RPC error (405). _Deviation from design D2: GET/DELETE are answered with an explicit 405 JSON-RPC error rather than routed to the transport — in this SDK's stateless mode a GET opens a dead standalone SSE stream (200) instead of refusing, and this surface never server-pushes, so refusing is both spec-correct and avoids a hanging stream._
- [x] 1.4 Register the MCP endpoint from `buildHttpApp` (single call, `/mcp` outside `/api/v1`); MCP routes marked `hide: true` so the OpenAPI snapshot/contract tests stay REST-only and pass unchanged.

## 2. Composition root: drop stdio

- [x] 2.1 Remove `StdioServerTransport` import, `buildMcpServer` call, `mcpServer.connect(...)`, and `mcpServer.close()` from `src/composition/index.ts`; MCP now rides on `buildHttpApp`/`httpApp.close()` (design D3).
- [x] 2.2 Update the composition-root doc comment to describe the single-process HTTP+MCP surface; `pnpm check` passes (331 tests, 100% coverage).

## 3. E2E: prove cross-interface interop

- [x] 3.1 Added `test/e2e/mcp.e2e.test.ts`: connects an SDK `StreamableHTTPClientTransport` client to the running container, completes the handshake, `tools/list`, and reads the `md://acquisitions` collection resource.
- [x] 3.2 Same file: submits an acquisition via the HTTP API and cancels it via the MCP `cancel_acquisition` tool on the same server, then polls to assert it settles as `Cancelled`. Verified green via `pnpm test:e2e` (3/3 E2E tests pass).

## 4. Docs and client migration

- [x] 4.1 Updated `README.md`: MCP is served at `http://<HTTP_HOST>:<HTTP_PORT>/mcp` over streamable HTTP, with a URL-form client-config snippet and a callout that stdio is removed (owner-approved break; tool/resource contracts unchanged).
- [x] 4.2 No persistent stdio entry existed in `~/.claude.json` to migrate (server was only launched ad-hoc). Added a project `.mcp.json` pointing at `http://localhost:3000/mcp`; that exact URL is exercised end-to-end by the E2E real-client session (3.1/3.2).

## 5. Finalize

- [x] 5.1 `pnpm check` (331 tests, 100% coverage) and `pnpm test:e2e` (3/3) both green. Committed with `jj` as `feat(mcp)!: serve MCP over streamable HTTP, drop stdio transport` on bookmark `feat/mcp-streamable-http`, with a `BREAKING CHANGE:` body. Not yet pushed.

// Interfaces layer — inbound adapters (HTTP, MCP) and the shared contract schemas.
// Depends on application use-cases + domain; never on adapters or composition.
export * from './contracts/index.js';
export * from './http/app.js';
export * from './mcp/server.js';

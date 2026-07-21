// The wire DTO schemas and the inbound/outbound ACL live with the module facade (module-
// architecture D2) — the interfaces consume them from there so the facade stays the single
// contract source.
export * from '../../facade/schemas.js';
export * from '../../facade/mapping.js';

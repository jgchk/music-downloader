// The wire DTO schemas and the inbound/outbound ACL live with the module facade (module-
// architecture D2) — the interfaces consume them from there so the facade stays the single
// contract source. The seam contracts (outbound events, inbound verdicts) remain interface-owned.
export * from '../../facade/schemas.js';
export * from '../../facade/mapping.js';
export * from './events/schemas.js';
export * from './events/mapping.js';
export * from './verdicts/schemas.js';
export * from './verdicts/mapping.js';

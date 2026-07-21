// The module's sole entry point (package.json `exports`): a pure barrel over the facade, its
// wire DTO schemas, and the ACL mapping — the single contract source every interface imports.
export * from './facade.js';
export * from './schemas.js';
export * from './mapping.js';

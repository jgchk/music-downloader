// SQLite adapters (D7/D8): the event store, checkpoint store, in-process event bus, polling
// catch-up, and the event-versioning/upcasting seam.
export { openEventDatabase } from './schema.js';
export type { EventDatabase } from './schema.js';
export { SqliteEventStore, SqliteCheckpointStore } from './event-store.js';
export { SqliteDeadLetterStore } from './dead-letters.js';
export { SqliteResourceLedger } from './resource-ledger.js';
export { InProcessEventBus, pollCatchUp } from './event-bus.js';
export { UpcasterRegistry, CURRENT_SCHEMA_VERSION } from './upcaster.js';
export type { Upcaster } from './upcaster.js';

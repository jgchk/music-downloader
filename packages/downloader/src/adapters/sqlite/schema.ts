import Database from 'better-sqlite3';

/**
 * The single SQLite database behind `EventStorePort` (D7): an append-only `events` table whose
 * `global_seq` gives the total order that drives projections and the reactor, plus a `checkpoints`
 * table for the durable reactor (D8) and a `source_resources` ownership ledger for source-resource
 * stewardship. `UNIQUE(stream_id, version)` is the optimistic-concurrency guard; WAL mode lets
 * readers (projections) run concurrently with the single writer.
 */
export type EventDatabase = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  global_seq     INTEGER PRIMARY KEY AUTOINCREMENT,
  stream_id      TEXT    NOT NULL,
  version        INTEGER NOT NULL,
  type           TEXT    NOT NULL,
  schema_version INTEGER NOT NULL,
  data           TEXT    NOT NULL,
  metadata       TEXT    NOT NULL,
  UNIQUE (stream_id, version)
);

CREATE TABLE IF NOT EXISTS checkpoints (
  consumer   TEXT    PRIMARY KEY,
  global_seq INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS parked_effects (
  stream_id     TEXT    PRIMARY KEY,
  global_seq    INTEGER NOT NULL,
  attempt       INTEGER NOT NULL,
  parked_at     TEXT    NOT NULL,
  next_retry_at TEXT    NOT NULL,
  last_error    TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS dead_letters (
  subscription TEXT    NOT NULL,
  global_seq   INTEGER NOT NULL,
  error        TEXT    NOT NULL,
  occurred_at  TEXT    NOT NULL,
  stream_id    TEXT,
  PRIMARY KEY (subscription, global_seq)
);

CREATE TABLE IF NOT EXISTS source_resources (
  source         TEXT NOT NULL,
  kind           TEXT NOT NULL,
  resource_key   TEXT NOT NULL,
  resource_id    TEXT,
  acquisition_id TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  removed_at     TEXT,
  PRIMARY KEY (source, kind, resource_key, acquisition_id)
);
`;

/** Open (creating if absent) the event database, enable WAL, and ensure the schema exists. */
export function openEventDatabase(filename: string): EventDatabase {
  const database = new Database(filename);
  database.pragma('journal_mode = WAL');
  database.exec(SCHEMA);
  migrate(database);
  return database;
}

/** Additive in-place migrations for databases created before a column existed. */
function migrate(database: EventDatabase): void {
  const deadLetterColumns = database.pragma('table_info(dead_letters)') as { name: string }[];
  if (deadLetterColumns.every((column) => column.name !== 'stream_id')) {
    database.exec('ALTER TABLE dead_letters ADD COLUMN stream_id TEXT');
  }
}

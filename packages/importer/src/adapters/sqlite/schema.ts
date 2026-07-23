import Database from 'better-sqlite3';

/**
 * The single SQLite database behind `EventStorePort`: an append-only `events` table whose
 * `global_seq` gives the total order that drives projections and the reactor, plus a `checkpoints`
 * table for the durable reactor. `UNIQUE(stream_id, version)` is the optimistic-concurrency
 * guard; WAL mode lets readers (projections) run concurrently with the single writer. This is the
 * service's own process log — entirely separate from beets' `library.db`, which this service never
 * touches directly.
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

CREATE TABLE IF NOT EXISTS dead_letters (
  subscription TEXT    NOT NULL,
  global_seq   INTEGER NOT NULL,
  error        TEXT    NOT NULL,
  occurred_at  TEXT    NOT NULL,
  stream_id    TEXT,
  PRIMARY KEY (subscription, global_seq)
);

CREATE TABLE IF NOT EXISTS parked_effects (
  global_seq INTEGER PRIMARY KEY,
  stream_id  TEXT    NOT NULL,
  attempt    INTEGER NOT NULL,
  parked_at  TEXT    NOT NULL,
  last_error TEXT    NOT NULL
);
`;

/** Open (creating if absent) the event database, enable WAL, and ensure the schema exists. */
export function openEventDatabase(filename: string): EventDatabase {
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

/** Additive in-place migrations for databases created before a column existed. */
function migrate(db: EventDatabase): void {
  const deadLetterColumns = db.pragma('table_info(dead_letters)') as { name: string }[];
  if (!deadLetterColumns.some((column) => column.name === 'stream_id')) {
    db.exec('ALTER TABLE dead_letters ADD COLUMN stream_id TEXT');
  }
}

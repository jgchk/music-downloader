import { errAsync, okAsync } from 'neverthrow';
import type { ResultAsync } from 'neverthrow';
import type { Statement } from 'better-sqlite3';
import type { ImportEvent, ImportEventType } from '../../domain/import/events.js';
import { infraError } from '../../application/ports/errors.js';
import type { InfraError } from '../../application/ports/errors.js';
import type {
  AppendError,
  CheckpointStore,
  EventBus,
  EventMetadata,
  EventStorePort,
  StoredEvent,
} from '../../application/ports/event-store-port.js';
import type { EventDatabase } from './schema.js';
import { buildUpcasterRegistry, CURRENT_SCHEMA_VERSION } from './upcaster.js';
import type { UpcasterRegistry } from './upcaster.js';

/**
 * The SQLite `EventStorePort` adapter. Optimistic concurrency is enforced twice: `append`
 * checks the stream's current length against `expectedVersion`, and `UNIQUE(stream_id, version)`
 * is the database-level backstop against a racing writer — both surface as `ConcurrencyConflict`.
 * On commit, freshly stored events are published to the optional {@link EventBus} (publish-after-
 * commit); the durable catch-up path is `readAll`. Old event shapes are upcast on read.
 */

interface EventRow {
  readonly global_seq: number;
  readonly stream_id: string;
  readonly version: number;
  readonly type: string;
  readonly schema_version: number;
  readonly data: string;
  readonly metadata: string;
}

/** Thrown inside the append transaction to roll it back on a version mismatch. */
class ConcurrencyBreak extends Error {}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE';
}

export class SqliteEventStore implements EventStorePort {
  private readonly insertStmt: Statement;
  private readonly countStmt: Statement;
  private readonly streamStmt: Statement;
  private readonly allStmt: Statement;
  private readonly runAppend: (
    streamId: string,
    expectedVersion: number,
    events: readonly ImportEvent[],
    metadata: EventMetadata,
  ) => StoredEvent[];

  constructor(
    database: EventDatabase,
    // Default to the populated registry so legacy on-disk shapes are lifted on the lazy path: a
    // store built without one still upcasts. Passing an empty `new UpcasterRegistry()` is an
    // explicit, deliberate opt-out (only tests that assert raw pass-through do so).
    private readonly upcasters: UpcasterRegistry = buildUpcasterRegistry(),
    private readonly bus?: EventBus,
  ) {
    this.insertStmt = database.prepare(
      `INSERT INTO events (stream_id, version, type, schema_version, data, metadata)
       VALUES (@streamId, @version, @type, @schemaVersion, @data, @metadata)`,
    );
    this.countStmt = database.prepare(`SELECT COUNT(*) AS c FROM events WHERE stream_id = ?`);
    this.streamStmt = database.prepare(
      `SELECT * FROM events WHERE stream_id = ? ORDER BY version ASC`,
    );
    this.allStmt = database.prepare(
      `SELECT * FROM events WHERE global_seq > ? ORDER BY global_seq ASC LIMIT ?`,
    );

    this.runAppend = database.transaction(
      (
        streamId: string,
        expectedVersion: number,
        events: readonly ImportEvent[],
        metadata: EventMetadata,
      ): StoredEvent[] => {
        const { c } = this.countStmt.get(streamId) as { c: number };
        if (c !== expectedVersion) throw new ConcurrencyBreak();

        const metaJson = JSON.stringify(metadata);
        return events.map((event, index) => {
          const version = expectedVersion + index;
          const info = this.insertStmt.run({
            streamId,
            version,
            type: event.type,
            schemaVersion: CURRENT_SCHEMA_VERSION,
            data: JSON.stringify(event),
            metadata: metaJson,
          });
          return {
            globalSeq: Number(info.lastInsertRowid),
            streamId,
            version,
            type: event.type,
            event,
            metadata,
          };
        });
      },
    );
  }

  append(
    streamId: string,
    expectedVersion: number,
    events: readonly ImportEvent[],
    metadata: EventMetadata,
  ): ResultAsync<readonly StoredEvent[], AppendError> {
    let stored: StoredEvent[];
    try {
      stored = this.runAppend(streamId, expectedVersion, events, metadata);
    } catch (error) {
      if (error instanceof ConcurrencyBreak || isUniqueViolation(error)) {
        return errAsync<readonly StoredEvent[], AppendError>({
          kind: 'ConcurrencyConflict',
          streamId,
          expectedVersion,
        });
      }
      return errAsync(infraError('event-store.append', String(error), error));
    }
    this.bus?.publish(stored);
    return okAsync(stored);
  }

  readStream(streamId: string): ResultAsync<readonly StoredEvent[], InfraError> {
    try {
      const rows = this.streamStmt.all(streamId) as EventRow[];
      return okAsync<readonly StoredEvent[], InfraError>(rows.map((row) => this.toStored(row)));
    } catch (error) {
      return errAsync(infraError('event-store.readStream', String(error), error));
    }
  }

  readAll(fromGlobalSeq: number, limit?: number): ResultAsync<readonly StoredEvent[], InfraError> {
    try {
      // better-sqlite3 treats LIMIT -1 as unlimited, keeping the unbounded reactor path intact.
      const rows = this.allStmt.all(fromGlobalSeq, limit ?? -1) as EventRow[];
      return okAsync<readonly StoredEvent[], InfraError>(rows.map((row) => this.toStored(row)));
    } catch (error) {
      return errAsync(infraError('event-store.readAll', String(error), error));
    }
  }

  private toStored(row: EventRow): StoredEvent {
    return {
      globalSeq: row.global_seq,
      streamId: row.stream_id,
      version: row.version,
      type: row.type as ImportEventType,
      event: this.upcasters.upcast(
        row.type,
        row.schema_version,
        JSON.parse(row.data) as Record<string, unknown>,
      ),
      metadata: JSON.parse(row.metadata) as EventMetadata,
    };
  }
}

/** The durable reactor checkpoint on SQLite: one row per consumer, upserted on save. */
export class SqliteCheckpointStore implements CheckpointStore {
  private readonly selectStmt: Statement;
  private readonly upsertStmt: Statement;

  constructor(database: EventDatabase) {
    this.selectStmt = database.prepare(`SELECT global_seq FROM checkpoints WHERE consumer = ?`);
    this.upsertStmt = database.prepare(
      `INSERT INTO checkpoints (consumer, global_seq) VALUES (?, ?)
       ON CONFLICT (consumer) DO UPDATE SET global_seq = excluded.global_seq`,
    );
  }

  load(consumer: string): ResultAsync<number, InfraError> {
    try {
      const row = this.selectStmt.get(consumer) as { global_seq: number } | undefined;
      return okAsync(row?.global_seq ?? 0);
    } catch (error) {
      return errAsync(infraError('checkpoint.load', String(error), error));
    }
  }

  save(consumer: string, globalSeq: number): ResultAsync<void, InfraError> {
    try {
      this.upsertStmt.run(consumer, globalSeq);
      return okAsync(undefined);
    } catch (error) {
      return errAsync(infraError('checkpoint.save', String(error), error));
    }
  }
}

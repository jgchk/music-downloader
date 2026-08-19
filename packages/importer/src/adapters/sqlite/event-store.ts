import { errAsync, okAsync } from 'neverthrow';
import { parseCausation } from '../../application/correlation/context.js';
import type { ResultAsync } from 'neverthrow';
import type { Statement } from 'better-sqlite3';
import type { ImportEvent } from '../../domain/import/events.js';
import { infraError } from '../../application/ports/errors.js';
import type { InfraError } from '../../application/ports/errors.js';
import type {
  AppendError,
  AppendMetadata,
  CheckpointStore,
  EventBus,
  EventMetadata,
  EventStorePort,
  StoredEvent,
} from '../../application/ports/event-store-port.js';
import type { EventDatabase } from './schema.js';
import { buildUpcasterRegistry, CURRENT_SCHEMA_VERSION } from './upcaster.js';
import { toModelType, toStoredToken } from './event-tokens.js';
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
    metadata: AppendMetadata,
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
        metadata: AppendMetadata,
      ): StoredEvent[] => {
        const { c } = this.countStmt.get(streamId) as { c: number };
        if (c !== expectedVersion) throw new ConcurrencyBreak();

        const metaJson = JSON.stringify(metadata);
        return events.map((event, index) => {
          const version = expectedVersion + index;
          // The stored token, not the model's name for the event — see `event-tokens.ts`. It is
          // rewritten inside `data` too: the blob is a whole-event stringify, so leaving the model
          // name there would fork the on-disk shape from the column it is indexed by.
          const storedToken = toStoredToken(event.type);
          const info = this.insertStmt.run({
            streamId,
            version,
            type: storedToken,
            schemaVersion: CURRENT_SCHEMA_VERSION,
            data: JSON.stringify({ ...event, type: storedToken }),
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
    metadata: AppendMetadata,
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
    // Upcasting runs first and is keyed by the STORED token, because legacy shapes were registered
    // under the names the log actually holds. Only once the payload is current does the token
    // become the model's name, so nothing above this adapter ever sees storage vocabulary.
    const modelType = toModelType(row.type);
    const upcast = this.upcasters.upcast(
      row.type,
      row.schema_version,
      JSON.parse(row.data) as Record<string, unknown>,
    );
    return {
      globalSeq: row.global_seq,
      streamId: row.stream_id,
      version: row.version,
      type: modelType,
      event: { ...upcast, type: modelType } as ImportEvent,
      // Metadata has no upcaster and no schema, so the cast is the only thing standing behind the
      // whole shape — and `causation` is a discriminated union whose tag nothing has checked.
      // Re-establish that one invariant here rather than let a future reader narrow on a lie.
      metadata: parseMetadata(JSON.parse(row.metadata)),
    };
  }
}

/**
 * Re-establish the read-side metadata shape. Only `causation` needs real parsing (it is a union);
 * the rest is carried through as written, and an absent or unreadable pair is normal — every row
 * written before end-to-end-correlation has none, permanently.
 */
function parseMetadata(raw: unknown): EventMetadata {
  // A row whose metadata is not an object at all (DB surgery is a documented ops procedure here) is
  // handed back exactly as found. THIS PARSE does not throw — `readStream` would turn a throw here
  // into an InfraError for the whole stream — and reshaping the value would fabricate provenance
  // nobody wrote: `{...'gone'}` is `{0:'g',1:'o',…}`, indistinguishable from a row really written
  // that way.
  //
  // Scope that claim honestly: it is a statement about this function, NOT about the row's fate. For
  // a JSON scalar the degradation is real (`'gone'.correlationId` is `undefined`). For `null` it is
  // not — `continueFrom` opens with `stored.metadata.correlationId`
  // (`application/correlation/context.ts`), so a `null` column throws a TypeError at the reader. It
  // does NOT take the process down (the reactors' `drain()` paths each catch and log; measured, not
  // assumed), but the checkpoint is untouched, so that row redelivers on every poll forever.
  //
  // Known defect, deliberately not fixed here. The obvious repair — returning `{}` for every
  // non-object — was drafted and rejected on review: `{}` is byte-identical to a legitimate
  // pre-correlation row, so `continueFrom` reports `origin: 'absent'` and both reactors log
  // corruption at DEBUG as "predates correlation metadata", which is the one arm the correlation
  // design (D16) reserves for permanent, unactionable history. It also leaves `occurredAt`
  // undefined behind a required declaration, which reaches a `z.iso.datetime()` field. The real fix
  // carries unreadability as a value — a third `StoryOrigin` the reactor can log as `malformed` —
  // and that is a cross-context change with its own design, not a line in a patch release.
  if (typeof raw !== 'object' || raw === null) return raw as EventMetadata;
  const parsed = raw as EventMetadata;
  // Unconditional: `parseCausation` already answers `undefined` for absent AND for unreadable, and
  // `causation` is optional on the read side, so there is nothing to branch on.
  return { ...parsed, causation: parseCausation((raw as { causation?: unknown }).causation) };
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

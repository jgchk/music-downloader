import { errAsync, okAsync } from 'neverthrow';
import type { ResultAsync } from 'neverthrow';
import type { Statement } from 'better-sqlite3';
import { infraError } from '../../application/ports/errors.js';
import type { InfraError } from '../../application/ports/errors.js';
import type {
  ParkedEffect,
  ParkedEffectStore,
} from '../../application/ports/parked-effect-port.js';
import type { EventDatabase } from './schema.js';

interface ParkedRow {
  readonly stream_id: string;
  readonly global_seq: number;
  readonly attempt: number;
  readonly parked_at: string;
  readonly next_retry_at: string;
  readonly last_error: string;
}

function toEntry(row: ParkedRow): ParkedEffect {
  return {
    streamId: row.stream_id,
    globalSeq: row.global_seq,
    attempt: row.attempt,
    parkedAt: row.parked_at,
    nextRetryAt: row.next_retry_at,
    lastError: row.last_error,
  };
}

/**
 * The SQLite {@link ParkedEffectStore} (reactor-durability D1): a sibling table to the reactor's
 * checkpoint in the module's own database file. `stream_id` is the primary key — one park per
 * stream — so re-parking after a crash or a rescheduled retry upserts and converges.
 */
export class SqliteParkedEffectStore implements ParkedEffectStore {
  private readonly upsertStmt: Statement;
  private readonly findStmt: Statement;
  private readonly dueStmt: Statement;
  private readonly clearStmt: Statement;

  constructor(db: EventDatabase) {
    this.upsertStmt = db.prepare(
      `INSERT INTO parked_effects (stream_id, global_seq, attempt, parked_at, next_retry_at, last_error)
       VALUES (@streamId, @globalSeq, @attempt, @parkedAt, @nextRetryAt, @lastError)
       ON CONFLICT (stream_id) DO UPDATE SET
         global_seq = excluded.global_seq,
         attempt = excluded.attempt,
         parked_at = excluded.parked_at,
         next_retry_at = excluded.next_retry_at,
         last_error = excluded.last_error`,
    );
    this.findStmt = db.prepare(`SELECT * FROM parked_effects WHERE stream_id = ?`);
    this.dueStmt = db.prepare(
      `SELECT * FROM parked_effects WHERE next_retry_at <= ? ORDER BY next_retry_at ASC`,
    );
    this.clearStmt = db.prepare(`DELETE FROM parked_effects WHERE stream_id = ?`);
  }

  park(entry: ParkedEffect): ResultAsync<void, InfraError> {
    try {
      this.upsertStmt.run({
        streamId: entry.streamId,
        globalSeq: entry.globalSeq,
        attempt: entry.attempt,
        parkedAt: entry.parkedAt,
        nextRetryAt: entry.nextRetryAt,
        lastError: entry.lastError,
      });
      return okAsync(undefined);
    } catch (err) {
      return errAsync(infraError('parked-effects.park', String(err), err));
    }
  }

  find(streamId: string): ResultAsync<ParkedEffect | undefined, InfraError> {
    try {
      const row = this.findStmt.get(streamId) as ParkedRow | undefined;
      return okAsync(row === undefined ? undefined : toEntry(row));
    } catch (err) {
      return errAsync(infraError('parked-effects.find', String(err), err));
    }
  }

  due(nowIso: string): ResultAsync<readonly ParkedEffect[], InfraError> {
    try {
      const rows = this.dueStmt.all(nowIso) as ParkedRow[];
      return okAsync<readonly ParkedEffect[], InfraError>(rows.map(toEntry));
    } catch (err) {
      return errAsync(infraError('parked-effects.due', String(err), err));
    }
  }

  clear(streamId: string): ResultAsync<void, InfraError> {
    try {
      this.clearStmt.run(streamId);
      return okAsync(undefined);
    } catch (err) {
      return errAsync(infraError('parked-effects.clear', String(err), err));
    }
  }
}

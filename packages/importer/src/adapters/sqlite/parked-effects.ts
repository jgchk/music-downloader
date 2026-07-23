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
  readonly global_seq: number;
  readonly stream_id: string;
  readonly attempt: number;
  readonly parked_at: string;
  readonly last_error: string;
}

function toEntry(row: ParkedRow): ParkedEffect {
  return {
    globalSeq: row.global_seq,
    streamId: row.stream_id,
    attempt: row.attempt,
    parkedAt: row.parked_at,
    lastError: row.last_error,
  };
}

/**
 * The SQLite {@link ParkedEffectStore} (reactor-durability parity): a sibling table to the reactor's
 * checkpoint in the module's own database file. `global_seq` is the primary key — one park per held
 * event — so re-parking after a crash or a further failed attempt upserts the tally and converges.
 */
export class SqliteParkedEffectStore implements ParkedEffectStore {
  private readonly upsertStmt: Statement;
  private readonly findStmt: Statement;
  private readonly clearStmt: Statement;

  constructor(db: EventDatabase) {
    this.upsertStmt = db.prepare(
      `INSERT INTO parked_effects (global_seq, stream_id, attempt, parked_at, last_error)
       VALUES (@globalSeq, @streamId, @attempt, @parkedAt, @lastError)
       ON CONFLICT (global_seq) DO UPDATE SET
         stream_id = excluded.stream_id,
         attempt = excluded.attempt,
         parked_at = excluded.parked_at,
         last_error = excluded.last_error`,
    );
    this.findStmt = db.prepare(`SELECT * FROM parked_effects WHERE global_seq = ?`);
    this.clearStmt = db.prepare(`DELETE FROM parked_effects WHERE global_seq = ?`);
  }

  park(entry: ParkedEffect): ResultAsync<void, InfraError> {
    try {
      this.upsertStmt.run({
        globalSeq: entry.globalSeq,
        streamId: entry.streamId,
        attempt: entry.attempt,
        parkedAt: entry.parkedAt,
        lastError: entry.lastError,
      });
      return okAsync(undefined);
    } catch (err) {
      return errAsync(infraError('parked-effects.park', String(err), err));
    }
  }

  find(globalSeq: number): ResultAsync<ParkedEffect | undefined, InfraError> {
    try {
      const row = this.findStmt.get(globalSeq) as ParkedRow | undefined;
      return okAsync(row === undefined ? undefined : toEntry(row));
    } catch (err) {
      return errAsync(infraError('parked-effects.find', String(err), err));
    }
  }

  clear(globalSeq: number): ResultAsync<void, InfraError> {
    try {
      this.clearStmt.run(globalSeq);
      return okAsync(undefined);
    } catch (err) {
      return errAsync(infraError('parked-effects.clear', String(err), err));
    }
  }
}

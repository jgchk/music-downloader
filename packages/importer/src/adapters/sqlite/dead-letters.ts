import { errAsync, okAsync } from 'neverthrow';
import type { ResultAsync } from 'neverthrow';
import type { Statement } from 'better-sqlite3';
import { infraError } from '../../application/ports/errors.js';
import type { InfraError } from '../../application/ports/errors.js';
import type { DeadLetter, DeadLetterStore } from '../../application/ports/dead-letter-port.js';
import type { EventDatabase } from './schema.js';

/**
 * The SQLite {@link DeadLetterStore}: one row per parked event per subscription, in the consuming
 * module's own database file (merge-modular-monolith D7). Idempotent on redelivery — re-parking
 * the same position upserts rather than fails, so park-then-crash-then-repark converges.
 */
export class SqliteDeadLetterStore implements DeadLetterStore {
  private readonly insertStmt: Statement;
  private readonly listStmt: Statement;

  constructor(db: EventDatabase) {
    this.insertStmt = db.prepare(
      `INSERT INTO dead_letters (subscription, global_seq, error, occurred_at)
       VALUES (@subscription, @globalSeq, @error, @occurredAt)
       ON CONFLICT (subscription, global_seq) DO UPDATE
         SET error = excluded.error, occurred_at = excluded.occurred_at`,
    );
    this.listStmt = db.prepare(
      `SELECT subscription, global_seq, error, occurred_at
       FROM dead_letters WHERE subscription = ? ORDER BY global_seq ASC`,
    );
  }

  record(letter: DeadLetter): ResultAsync<void, InfraError> {
    try {
      this.insertStmt.run({
        subscription: letter.subscription,
        globalSeq: letter.globalSeq,
        error: letter.error,
        occurredAt: letter.occurredAt,
      });
      return okAsync(undefined);
    } catch (err) {
      return errAsync(infraError('dead-letters.record', String(err), err));
    }
  }

  list(subscription: string): ResultAsync<readonly DeadLetter[], InfraError> {
    try {
      const rows = this.listStmt.all(subscription) as readonly {
        subscription: string;
        global_seq: number;
        error: string;
        occurred_at: string;
      }[];
      return okAsync<readonly DeadLetter[], InfraError>(
        rows.map((row) => ({
          subscription: row.subscription,
          globalSeq: row.global_seq,
          error: row.error,
          occurredAt: row.occurred_at,
        })),
      );
    } catch (err) {
      return errAsync(infraError('dead-letters.list', String(err), err));
    }
  }
}

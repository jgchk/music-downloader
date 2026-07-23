import type { ResultAsync } from 'neverthrow';
import type { InfraError } from './errors.js';

/**
 * Dead letters for cross-module subscriptions (merge-modular-monolith D7) and for the reactor's
 * budget-exhausted effects (reactor-durability parity): when a subscription declared `park` exhausts
 * a poison event — or the reactor spends an effect's retry budget — the position and failure are
 * recorded here, in the CONSUMING module's own store, and processing advances. Parked letters are an
 * operator surface: inspect, fix, and replay via a checkpoint reset. Reactor letters carry
 * `streamId` so the owning import can be exposed as stalled.
 */
export interface DeadLetter {
  readonly subscription: string;
  readonly globalSeq: number;
  readonly error: string;
  readonly occurredAt: string; // ISO-8601
  /** The owning stream, present on reactor effect dead-letters (drives the stalled read model). */
  readonly streamId?: string;
}

export interface DeadLetterStore {
  record(letter: DeadLetter): ResultAsync<void, InfraError>;
  list(subscription: string): ResultAsync<readonly DeadLetter[], InfraError>;
  /** Drop a resolved stream's letters (idempotent) — the import is no longer stalled. */
  clearStream(subscription: string, streamId: string): ResultAsync<void, InfraError>;
  /** Retention (reactor-durability parity): drop letters older than the horizon (ISO-8601). */
  prune(subscription: string, olderThanIso: string): ResultAsync<void, InfraError>;
}

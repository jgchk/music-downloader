import type { ResultAsync } from 'neverthrow';
import type { InfraError } from './errors.js';

/**
 * Dead letters for cross-module subscriptions (merge-modular-monolith D7) and for the reactor's
 * budget-exhausted effects (reactor-durability D2): when a subscription declared `park` exhausts a
 * poison event — or an effect with no modeled failure spends its retry budget or fails
 * permanently — the position and
 * failure are recorded here, in the CONSUMING module's own store, and processing advances. Parked
 * letters are an operator surface: inspect, fix, and replay via a checkpoint reset. Reactor
 * letters carry `streamId` so the owning acquisition can be exposed as stalled.
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
  /** Drop a resolved stream's letters (idempotent) — the acquisition is no longer stalled. */
  clearStream(subscription: string, streamId: string): ResultAsync<void, InfraError>;
  /** Retention (reactor-durability D2): drop letters older than the horizon (ISO-8601). */
  prune(subscription: string, olderThanIso: string): ResultAsync<void, InfraError>;
}

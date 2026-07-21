import type { ResultAsync } from 'neverthrow';
import type { InfraError } from './errors.js';

/**
 * Dead letters for cross-module subscriptions (merge-modular-monolith D7): when a subscription
 * declared `park` exhausts a poison event, the event's position and failure are recorded here —
 * in the CONSUMING module's own store — and the subscription advances. Parked letters are an
 * operator surface: inspect, fix, and replay via a checkpoint reset.
 */
export interface DeadLetter {
  readonly subscription: string;
  readonly globalSeq: number;
  readonly error: string;
  readonly occurredAt: string; // ISO-8601
}

export interface DeadLetterStore {
  record(letter: DeadLetter): ResultAsync<void, InfraError>;
  list(subscription: string): ResultAsync<readonly DeadLetter[], InfraError>;
}

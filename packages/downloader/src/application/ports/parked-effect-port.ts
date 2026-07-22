import type { ResultAsync } from 'neverthrow';
import type { InfraError } from './errors.js';

/**
 * Durable per-stream retry state for the reactor (reactor-durability D1): when an effect fails
 * retryably, its stream is parked here — scheduling data only, never facts — and the global
 * checkpoint advances past it. At most one park per stream: later events of a parked stream queue
 * behind it in the log (the no-leapfrog invariant), so the entry marks the whole stream, keyed by
 * the event whose effect failed. Losing this table degrades safely to the startup re-drive (D3).
 */
export interface ParkedEffect {
  readonly streamId: string;
  /** The event whose effect failed; retries re-dispatch from this position. */
  readonly globalSeq: number;
  /** Failed attempts so far (>= 1). */
  readonly attempt: number;
  /** First failure instant (ISO-8601) — anchors the wall-clock retry budget. */
  readonly parkedAt: string;
  /** When the next retry is due (ISO-8601). */
  readonly nextRetryAt: string;
  readonly lastError: string;
}

export interface ParkedEffectStore {
  /** Record (or reschedule — upsert by stream) the stream's parked effect. */
  park(entry: ParkedEffect): ResultAsync<void, InfraError>;
  find(streamId: string): ResultAsync<ParkedEffect | undefined, InfraError>;
  /** Entries whose retry is due at `nowIso`, soonest-scheduled first. */
  due(nowIso: string): ResultAsync<readonly ParkedEffect[], InfraError>;
  /** Remove the stream's park (idempotent) — on success, degradation, or dead-letter. */
  clear(streamId: string): ResultAsync<void, InfraError>;
}

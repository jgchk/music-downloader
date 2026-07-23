import type { ResultAsync } from 'neverthrow';
import type { InfraError } from './errors.js';

/**
 * Durable retry-budget state for the reactor (reactor-durability parity): when an effect fails
 * retryably below its budget, the reactor holds the global checkpoint and records the attempt tally
 * here — scheduling data only, never facts — so the budget survives a restart instead of resetting
 * to zero on every reboot (the "poison effect re-retries forever" class). Keyed by the failing
 * event's `globalSeq`: the importer reactor holds the single global checkpoint at the head, so at
 * most one effect is *actively* parked at a time (its later events queue behind it in the unadvanced
 * log; a resolved row is cleared idempotently, so a rare clear-fault can leave a harmless leftover).
 *
 * Deliberate divergence from the downloader's `ParkedEffectStore`: no `nextRetryAt`/`due` — the
 * importer reactor has no backoff scheduler, it re-drives the held event on the fallback poll and on
 * boot via the drain re-reading from the held checkpoint. Losing this table degrades safely: the
 * held event simply re-retries from a fresh budget.
 */
export interface ParkedEffect {
  /** The event whose effect failed; the durable key (the held checkpoint head). Read to resume. */
  readonly globalSeq: number;
  /** The owning import stream — an operator/diagnostic surface on the row (not read on the retry path). */
  readonly streamId: string;
  /** Failed attempts so far (>= 1) — the tally the reactor resumes from. */
  readonly attempt: number;
  /** First failure instant (ISO-8601), preserved across attempts. */
  readonly parkedAt: string;
  /** The last rendered failure — an operator/diagnostic surface on the row (not read on the retry path). */
  readonly lastError: string;
}

export interface ParkedEffectStore {
  /** Record (or update — upsert by `globalSeq`) the held event's retry tally. */
  park(entry: ParkedEffect): ResultAsync<void, InfraError>;
  find(globalSeq: number): ResultAsync<ParkedEffect | undefined, InfraError>;
  /** Remove the tally (idempotent) — on the effect's success or once it is dead-lettered. */
  clear(globalSeq: number): ResultAsync<void, InfraError>;
}

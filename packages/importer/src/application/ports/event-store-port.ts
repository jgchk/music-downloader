import type { ResultAsync } from 'neverthrow';
import type { ImportEvent, ImportEventType } from '../../domain/import/events.js';
import type { CausationReference } from '../correlation/context.js';
import type { InfraError } from './errors.js';

/**
 * The event store: append / read-stream / read-all behind a port so the SQLite adapter can
 * be swapped for Postgres later without touching the application. `global_seq` gives the total
 * order that drives projections and the reactor; `UNIQUE(stream_id, version)` is optimistic
 * concurrency, surfaced here as {@link ConcurrencyConflict}.
 */
/**
 * Metadata as READ back from the store. The operation-correlation pair is optional here and always
 * will be: every row written before end-to-end-correlation shipped has neither field, those rows
 * are never backfilled, and no upcaster may fabricate provenance that never happened. A reader that
 * required either field would fail to replay real production history.
 */
export interface EventMetadata {
  readonly importId: string;
  readonly occurredAt: string; // ISO-8601
  readonly correlationId?: string;
  readonly causation?: CausationReference;
}

/**
 * Metadata as WRITTEN. The same shape with the correlation pair made mandatory — the asymmetry is
 * the point: tolerance belongs to the reader, and nothing appended from today on may be
 * uncorrelated. Because {@link EventStorePort.append} takes this type, a call site that has no
 * {@link CommandContext} to derive it from is a compile error rather than a silently broken chain.
 */
export interface AppendMetadata extends EventMetadata {
  readonly correlationId: string;
  readonly causation: CausationReference;
}

export interface StoredEvent {
  readonly globalSeq: number;
  readonly streamId: string;
  readonly version: number;
  readonly type: ImportEventType;
  readonly event: ImportEvent;
  readonly metadata: EventMetadata;
}

export interface ConcurrencyConflict {
  readonly kind: 'ConcurrencyConflict';
  readonly streamId: string;
  readonly expectedVersion: number;
}

export type AppendError = InfraError | ConcurrencyConflict;

export interface EventStorePort {
  /** Append `events` to `streamId` iff its current version equals `expectedVersion`. */
  append(
    streamId: string,
    expectedVersion: number,
    events: readonly ImportEvent[],
    metadata: AppendMetadata,
  ): ResultAsync<readonly StoredEvent[], AppendError>;

  readStream(streamId: string): ResultAsync<readonly StoredEvent[], InfraError>;

  /**
   * All events after `fromGlobalSeq`, in global order — the projection/reactor catch-up path.
   * `limit` bounds the batch (absent = unbounded) for checkpointed consumers that drain in steps.
   */
  readAll(fromGlobalSeq: number, limit?: number): ResultAsync<readonly StoredEvent[], InfraError>;
}

/** The durable reactor checkpoint: last global_seq a consumer has processed. */
export interface CheckpointStore {
  load(consumer: string): ResultAsync<number, InfraError>; // 0 when never checkpointed
  save(consumer: string, globalSeq: number): ResultAsync<void, InfraError>;
}

/** In-process publish-after-commit fan-out; the durable catch-up path is `readAll`. */
export interface EventBus {
  publish(events: readonly StoredEvent[]): void;
  subscribe(handler: (event: StoredEvent) => void): () => void;
}

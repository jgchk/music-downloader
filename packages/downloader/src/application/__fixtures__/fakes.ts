import { errAsync, okAsync } from 'neverthrow';
import type { ResultAsync } from 'neverthrow';
import type { AcquisitionEvent } from '../../domain/acquisition/events.js';
import { createLogger } from '../logging/logger.js';
import type { Logger } from '../logging/logger.js';
import { infraError } from '../ports/errors.js';
import type { InfraError } from '../ports/errors.js';
import type {
  AppendError,
  CheckpointStore,
  EventBus,
  EventMetadata,
  EventStorePort,
  StoredEvent,
} from '../ports/event-store-port.js';
import type { DeadLetter, DeadLetterStore } from '../ports/dead-letter-port.js';
import type { ParkedEffect, ParkedEffectStore } from '../ports/parked-effect-port.js';
import type {
  ResourceLedgerStore,
  SourceResource,
  SourceResourceKey,
} from '../ports/resource-ledger-port.js';
import type { Clock, IdGenerator } from '../ports/system-ports.js';

/** A minimal in-memory event store for application-layer tests (optimistic concurrency, global order). */
export class FakeEventStore implements EventStorePort {
  private readonly events: StoredEvent[] = [];
  public failReads = false;
  public failReadAll = false;
  /** Fail appends with an infra fault, or with a concurrency conflict. */
  public failAppends = false;
  public conflictAppends = false;
  /** Throw (not err) from readAll — for specs that pin bug-backstop behavior. */
  public throwOnReadAll = false;

  append(
    streamId: string,
    expectedVersion: number,
    events: readonly AcquisitionEvent[],
    metadata: EventMetadata,
  ): ResultAsync<readonly StoredEvent[], AppendError> {
    if (this.failAppends) return errAsync(infraError('event-store.append', 'boom'));
    const current = this.events.filter((entry) => entry.streamId === streamId);
    if (this.conflictAppends || current.length !== expectedVersion) {
      return errAsync({ kind: 'ConcurrencyConflict', streamId, expectedVersion });
    }
    const stored = events.map((event, index) => ({
      globalSeq: this.events.length + index + 1,
      streamId,
      version: expectedVersion + index,
      type: event.type,
      event,
      metadata,
    }));
    this.events.push(...stored);
    return okAsync(stored);
  }

  readStream(streamId: string): ResultAsync<readonly StoredEvent[], InfraError> {
    if (this.failReads) return errAsync(infraError('readStream', 'boom'));
    return okAsync(this.events.filter((entry) => entry.streamId === streamId));
  }

  readAll(fromGlobalSeq: number, limit?: number): ResultAsync<readonly StoredEvent[], InfraError> {
    if (this.throwOnReadAll) throw new Error('boom');
    if (this.failReadAll) return errAsync(infraError('readAll', 'boom'));
    const rows = this.events.filter((entry) => entry.globalSeq > fromGlobalSeq);
    return okAsync(limit === undefined ? rows : rows.slice(0, limit));
  }

  all(): readonly StoredEvent[] {
    return this.events;
  }
}

export class FakeCheckpointStore implements CheckpointStore {
  private readonly checkpoints = new Map<string, number>();
  public failLoad = false;
  public failSaves = false;

  load(consumer: string): ResultAsync<number, InfraError> {
    if (this.failLoad) return errAsync(infraError('checkpoint.load', 'boom'));
    return okAsync(this.checkpoints.get(consumer) ?? 0);
  }

  save(consumer: string, globalSeq: number): ResultAsync<void, InfraError> {
    if (this.failSaves) return errAsync(infraError('checkpoint.save', 'boom'));
    this.checkpoints.set(consumer, globalSeq);
    return okAsync(undefined);
  }

  peek(consumer: string): number | undefined {
    return this.checkpoints.get(consumer);
  }
}

export class FakeEventBus implements EventBus {
  private readonly handlers = new Set<(event: StoredEvent) => void>();

  publish(events: readonly StoredEvent[]): void {
    for (const event of events) {
      for (const handler of this.handlers) handler(event);
    }
  }

  subscribe(handler: (event: StoredEvent) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  subscriberCount(): number {
    return this.handlers.size;
  }
}

function ledgerKeyString(key: SourceResourceKey): string {
  return [key.source, key.kind, key.resourceKey, key.acquisitionId].join('\u{0}');
}

/** An in-memory {@link ResourceLedgerStore} for adapter/sweep tests; records calls for assertions. */
export class FakeResourceLedger implements ResourceLedgerStore {
  readonly created: SourceResource[] = [];
  readonly ids: { key: SourceResourceKey; id: string }[] = [];
  readonly removed: SourceResourceKey[] = [];
  public fail = false;
  public failMarkRemoved = false;

  private failed<T>(op: string): ResultAsync<T, InfraError> {
    return errAsync(infraError(`resource-ledger.${op}`, 'boom'));
  }

  recordCreated(resource: SourceResource): ResultAsync<void, InfraError> {
    if (this.fail) return this.failed('recordCreated');
    if (this.created.every((r) => ledgerKeyString(r) !== ledgerKeyString(resource))) {
      this.created.push(resource);
    }
    return okAsync(undefined);
  }

  recordId(key: SourceResourceKey, resourceId: string): ResultAsync<void, InfraError> {
    if (this.fail) return this.failed('recordId');
    this.ids.push({ key, id: resourceId });
    return okAsync(undefined);
  }

  markRemoved(key: SourceResourceKey): ResultAsync<void, InfraError> {
    if (this.fail || this.failMarkRemoved) return this.failed('markRemoved');
    this.removed.push(key);
    return okAsync(undefined);
  }

  liveByAcquisition(acquisitionId: string): ResultAsync<readonly SourceResource[], InfraError> {
    if (this.fail) return this.failed('liveByAcquisition');
    return okAsync(this.live().filter((r) => r.acquisitionId === acquisitionId));
  }

  allLive(): ResultAsync<readonly SourceResource[], InfraError> {
    if (this.fail) return this.failed('allLive');
    return okAsync(this.live());
  }

  private live(): SourceResource[] {
    const removedKeys = new Set(this.removed.map((item) => ledgerKeyString(item)));
    return this.created
      .filter((r) => !removedKeys.has(ledgerKeyString(r)))
      .map((r) => {
        const learned = this.ids.find((entry) => ledgerKeyString(entry.key) === ledgerKeyString(r));
        return learned ? { ...r, resourceId: learned.id } : r;
      });
  }
}

/** A logger that discards output — for tests that exercise logging call sites without noise. */
export function silentLogger(): Logger {
  return createLogger({ level: 'silent', destination: { write: () => {} } });
}

export function fixedClock(iso = '2026-07-03T12:00:00.000Z'): Clock {
  const date = new Date(iso);
  return { now: () => date };
}

export interface SettableClock extends Clock {
  advance(ms: number): void;
}

/** A clock tests move forward explicitly — for retry-scheduling specs. */
export function settableClock(iso = '2026-07-03T12:00:00.000Z'): SettableClock {
  let current = new Date(iso);
  return {
    now: () => current,
    advance(ms: number) {
      current = new Date(current.getTime() + ms);
    },
  };
}

export function sequentialIds(prefix = 'acq'): IdGenerator {
  let n = 0;
  return {
    next: () => {
      n += 1;
      return `${prefix}-${n}`;
    },
  };
}

/** An in-memory {@link ParkedEffectStore} for reactor tests. */
export class FakeParkedEffectStore implements ParkedEffectStore {
  private readonly entries = new Map<string, ParkedEffect>();
  public failPark = false;
  public failFind = false;
  public failDue = false;
  public failClear = false;

  park(entry: ParkedEffect): ResultAsync<void, InfraError> {
    if (this.failPark) return errAsync(infraError('parked-effects.park', 'boom'));
    this.entries.set(entry.streamId, entry);
    return okAsync(undefined);
  }

  find(streamId: string): ResultAsync<ParkedEffect | undefined, InfraError> {
    if (this.failFind) return errAsync(infraError('parked-effects.find', 'boom'));
    return okAsync(this.entries.get(streamId));
  }

  due(nowIso: string): ResultAsync<readonly ParkedEffect[], InfraError> {
    if (this.failDue) return errAsync(infraError('parked-effects.due', 'boom'));
    return okAsync(
      this.entries
        .values()
        .filter((entry) => entry.nextRetryAt <= nowIso)
        .toArray()
        .toSorted((a, b) => a.nextRetryAt.localeCompare(b.nextRetryAt)),
    );
  }

  clear(streamId: string): ResultAsync<void, InfraError> {
    if (this.failClear) return errAsync(infraError('parked-effects.clear', 'boom'));
    this.entries.delete(streamId);
    return okAsync(undefined);
  }

  peek(streamId: string): ParkedEffect | undefined {
    return this.entries.get(streamId);
  }

  count(): number {
    return this.entries.size;
  }
}

/** An in-memory {@link DeadLetterStore} for subscription tests. */
export class FakeDeadLetterStore implements DeadLetterStore {
  public letters: DeadLetter[] = [];
  public failRecord = false;
  public failClearStream = false;
  public failList = false;
  public failPrune = false;

  record(letter: DeadLetter): ResultAsync<void, InfraError> {
    if (this.failRecord) return errAsync(infraError('dead-letters.record', 'boom'));
    this.letters.push(letter);
    return okAsync(undefined);
  }

  list(subscription: string): ResultAsync<readonly DeadLetter[], InfraError> {
    if (this.failList) return errAsync(infraError('dead-letters.list', 'boom'));
    return okAsync(this.letters.filter((entry) => entry.subscription === subscription));
  }

  clearStream(subscription: string, streamId: string): ResultAsync<void, InfraError> {
    if (this.failClearStream) return errAsync(infraError('dead-letters.clearStream', 'boom'));
    this.letters = this.letters.filter(
      (entry) => entry.subscription !== subscription || entry.streamId !== streamId,
    );
    return okAsync(undefined);
  }

  prune(subscription: string, olderThanIso: string): ResultAsync<void, InfraError> {
    if (this.failPrune) return errAsync(infraError('dead-letters.prune', 'boom'));
    this.letters = this.letters.filter(
      (entry) => entry.subscription !== subscription || entry.occurredAt >= olderThanIso,
    );
    return okAsync(undefined);
  }
}

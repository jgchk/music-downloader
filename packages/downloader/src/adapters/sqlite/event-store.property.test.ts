import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { assertAsyncProperty } from '../../__fixtures__/property.js';
import type { EventMetadata, StoredEvent } from '../../application/ports/event-store-port.js';
import type { AcquisitionEvent } from '../../domain/acquisition/events.js';
import { arbEvent } from '../../domain/acquisition/__fixtures__/arbitraries.js';
import { SqliteEventStore } from './event-store.js';
import { openEventDatabase } from './schema.js';

/**
 * The one reference model in the property tier (decider-properties D5).
 *
 * Everywhere else this change refuses a parallel model: the deciders are already pure functions, so
 * a second implementation would be a drifting near-duplicate. The event store is the seam where
 * that argument inverts — SQLite, a transaction, a rolled-back version check and a UNIQUE backstop
 * are genuine stateful complexity, and a map-plus-a-counter is a model small enough to be obviously
 * right. Model-based commands generalize the store's existing conflict tests from the two
 * interleavings someone wrote down to every interleaving fast-check can build.
 *
 * The model states the contract in one line: an append succeeds exactly when `expectedVersion`
 * equals the stream's current length, and fails as `ConcurrencyConflict` otherwise.
 */

const META: EventMetadata = { acquisitionId: 'acq', occurredAt: '2026-08-06T00:00:00.000Z' };

/** Streams are drawn from a tiny pool so racing writers actually collide. */
const STREAM_IDS = ['acq-1', 'acq-2'] as const;

/** One entry of the catch-up feed as the model remembers it. */
interface FeedEntry {
  /**
   * The sequence the store allocated. Recorded from the real append rather than predicted: the
   * store owns sequence allocation, and re-deriving SQLite's `AUTOINCREMENT` semantics here would
   * be the second implementation this change exists to avoid. The model's authority is over what
   * lands and in what order — asserted below as strictly increasing and never reused.
   */
  readonly globalSeq: number;
  readonly streamId: string;
  readonly version: number;
}

/** The whole model: how long each stream is, and the global order the reactor reads. */
interface StoreModel {
  readonly lengths: Map<string, number>;
  readonly globalOrder: FeedEntry[];
}

interface RealStore {
  readonly store: SqliteEventStore;
}

/**
 * What the corpus actually exercised. Two cases are easy to generate and easy to *miss*, and each
 * hides a real defect when missed: an empty batch is the only append whose version check is not
 * also backstopped by `UNIQUE(stream_id, version)`, and a read is only a *paged* read when the page
 * is smaller than what is available. The suite asserts both were reached, so neither property can
 * pass by never having been tried.
 */
const coverage = { emptyAppendsRefused: 0, pagedReadsTruncated: 0 };

function lengthOf(model: StoreModel, streamId: string): number {
  return model.lengths.get(streamId) ?? 0;
}

/** What the model says a stream holds: versions 0..n-1, in order. */
function expectedVersions(model: StoreModel, streamId: string): number[] {
  return Array.from({ length: lengthOf(model, streamId) }, (_unused, index) => index);
}

class AppendCommand implements fc.AsyncCommand<StoreModel, RealStore> {
  constructor(
    private readonly streamId: string,
    private readonly expectedVersion: number,
    private readonly events: readonly AcquisitionEvent[],
  ) {}

  check(): boolean {
    return true; // every append is legal to *attempt*; whether it lands is the property
  }

  async run(model: StoreModel, real: RealStore): Promise<void> {
    const current = lengthOf(model, this.streamId);
    const shouldConflict = this.expectedVersion !== current;

    const outcome = await real.store.append(this.streamId, this.expectedVersion, this.events, META);

    if (shouldConflict) {
      // An empty batch inserts nothing, so `UNIQUE(stream_id, version)` cannot catch it: the
      // in-transaction version check is the ONLY thing standing between a stale writer and a
      // silently-accepted no-op that would tell it its read was current.
      if (this.events.length === 0) coverage.emptyAppendsRefused += 1;
      expect(outcome._unsafeUnwrapErr()).toEqual({
        kind: 'ConcurrencyConflict',
        streamId: this.streamId,
        expectedVersion: this.expectedVersion,
      });
      return; // a conflicted append is a rollback: the model does not move
    }

    const stored = outcome._unsafeUnwrap();
    expect(stored.map((row) => row.version)).toEqual(
      this.events.map((_unused, index) => this.expectedVersion + index),
    );
    // The global sequence is the reactor's total order: it only ever moves forward, across the
    // whole store, and never hands the same sequence out twice.
    const highestSoFar = model.globalOrder.at(-1)?.globalSeq ?? 0;
    const sequences = stored.map((row) => row.globalSeq);
    expect(sequences).toEqual([...sequences].toSorted(ascending));
    expect(sequences.filter((sequence) => sequence <= highestSoFar)).toEqual([]);

    model.lengths.set(this.streamId, current + this.events.length);
    for (const row of stored) {
      model.globalOrder.push({
        globalSeq: row.globalSeq,
        streamId: row.streamId,
        version: row.version,
      });
    }
  }

  toString(): string {
    return `append(${this.streamId}, @${String(this.expectedVersion)}, ${String(this.events.length)} events)`;
  }
}

class ReadStreamCommand implements fc.AsyncCommand<StoreModel, RealStore> {
  constructor(private readonly streamId: string) {}

  check(): boolean {
    return true;
  }

  async run(model: StoreModel, real: RealStore): Promise<void> {
    const read = await real.store.readStream(this.streamId);
    const stored = read._unsafeUnwrap();

    // A stream is a gapless, ascending run of versions from 0 — no conflicted append left a hole.
    expect(stored.map((row) => row.version)).toEqual(expectedVersions(model, this.streamId));
    expect(stored.every((row) => row.streamId === this.streamId)).toBe(true);
  }

  toString(): string {
    return `readStream(${this.streamId})`;
  }
}

class ReadAllCommand implements fc.AsyncCommand<StoreModel, RealStore> {
  constructor(
    private readonly fromGlobalSeq: number,
    private readonly limit: number | undefined,
  ) {}

  check(): boolean {
    return true;
  }

  async run(model: StoreModel, real: RealStore): Promise<void> {
    const read = await real.store.readAll(this.fromGlobalSeq, this.limit);
    const stored = read._unsafeUnwrap();

    // The catch-up feed: everything strictly after the checkpoint, in global order, one page at a
    // time. A conflicted append contributed nothing, so it can never appear here.
    const after = model.globalOrder.filter((entry) => entry.globalSeq > this.fromGlobalSeq);
    const expected = this.limit === undefined ? after : after.slice(0, this.limit);
    if (expected.length < after.length) coverage.pagedReadsTruncated += 1;

    expect(stored.map((row) => identify(row))).toEqual(expected);
  }

  toString(): string {
    return `readAll(from ${String(this.fromGlobalSeq)}, limit ${String(this.limit ?? -1)})`;
  }
}

const ascending = (a: number, b: number): number => a - b;

function identify(row: StoredEvent): FeedEntry {
  return { globalSeq: row.globalSeq, streamId: row.streamId, version: row.version };
}

describe('the SQLite store agrees with an expected-version model on every interleaving', () => {
  const commandArbitraries = [
    fc
      .tuple(
        fc.constantFrom(...STREAM_IDS),
        fc.integer({ min: 0, max: 4 }),
        fc.array(arbEvent, { minLength: 1, maxLength: 2 }),
      )
      .map(
        ([streamId, expectedVersion, events]) =>
          new AppendCommand(streamId, expectedVersion, events),
      ),
    // An append of nothing, as its own generator rather than a rare draw from the one above: it is
    // the only append the UNIQUE constraint cannot backstop, so it must be tried on purpose.
    fc
      .tuple(fc.constantFrom(...STREAM_IDS), fc.integer({ min: 0, max: 4 }))
      .map(([streamId, expectedVersion]) => new AppendCommand(streamId, expectedVersion, [])),
    fc.constantFrom(...STREAM_IDS).map((streamId) => new ReadStreamCommand(streamId)),
    fc
      .tuple(
        fc.integer({ min: 0, max: 3 }),
        // A page size small enough to actually truncate; `undefined` is the reactor's unbounded read.
        fc.option(fc.integer({ min: 1, max: 2 }), { nil: undefined }),
      )
      .map(([from, limit]) => new ReadAllCommand(from, limit)),
  ];

  it('never lands an append at the wrong version, and never reports a conflict for the right one', async () => {
    coverage.emptyAppendsRefused = 0;
    coverage.pagedReadsTruncated = 0;

    await assertAsyncProperty(
      fc.asyncProperty(
        fc.commands<StoreModel, RealStore, false>(commandArbitraries, { maxCommands: 15 }),
        async (commandSequence) => {
          const database = openEventDatabase(':memory:');
          try {
            await fc.asyncModelRun(
              () => ({
                model: { lengths: new Map<string, number>(), globalOrder: [] },
                real: { store: new SqliteEventStore(database) },
              }),
              commandSequence,
            );
          } finally {
            if (database.open) database.close();
          }
        },
      ),
    );

    expect(coverage.emptyAppendsRefused).toBeGreaterThan(0);
    expect(coverage.pagedReadsTruncated).toBeGreaterThan(0);
  });
});

import { publishedEventMapping } from '../contracts/events/mapping.js';
import { appendMetadata, testContext } from '../../application/__fixtures__/correlation.js';
import { describe, expect, it } from 'vitest';
import type { SeamEvent } from '../../application/events/catch-up-subscription.js';
import { importIdFor, submitImport } from '../../application/import/use-cases.js';
import { toOriginatingDownloadId } from '../../domain/shared/originating-download-id.js';
import { testWiring } from '../../facade/__fixtures__/wiring.js';
import type { TestWiring } from '../../facade/__fixtures__/wiring.js';
import { intakeEventConsumer } from './intake-consumer.js';
import type { IntakeConsumerOptions } from './intake-consumer.js';

const SOURCE_ROOT = '/downloads/import';
const INTAKE_ROOT = '/music/intake';

function fulfilledEvent(
  overrides: Partial<Record<string, unknown>> = {},
  globalSeq = 1,
): SeamEvent {
  return {
    globalSeq,
    type: (overrides.type as string | undefined) ?? 'acquisition.fulfilled',
    timestamp: '2026-07-18T12:00:00.000Z',
    data: {
      acquisitionId: 'acq-1',
      target: {
        type: 'album',
        artist: 'Radiohead',
        title: 'Kid A',
        musicbrainzReleaseId: 'mb-release-1',
        year: 2000, // unknown fields are ignored — tolerant reader
        trackCount: 2,
      },
      candidate: { username: 'peer1', path: 'peer1/x', sizeBytes: 1000 },
      location: `${SOURCE_ROOT}/Radiohead - Kid A`,
      files: [],
      ...overrides,
    },
  };
}

function consumer(
  wiring: TestWiring,
  overrides: Partial<IntakeConsumerOptions> = {},
): ReturnType<typeof intakeEventConsumer> {
  return intakeEventConsumer(wiring.deps, {
    sourceRoot: SOURCE_ROOT,
    intakeRoot: INTAKE_ROOT,
    directoryExists: () => Promise.resolve(true),
    warn: () => {},
    ...overrides,
  });
}

describe('the intake event consumer', () => {
  it('submits an import for the re-rooted directory with the event hints and provenance', async () => {
    const wiring = testWiring();
    const consume = consumer(wiring);

    const outcome = await consume(fulfilledEvent());

    expect(outcome.isOk()).toBe(true);
    const events = wiring.store.all();
    expect(events[0]?.type).toBe('ImportRequested');
    expect(events[0]?.event).toMatchObject({
      directory: `${INTAKE_ROOT}/Radiohead - Kid A`,
      hints: { mbReleaseId: 'mb-release-1', artist: 'Radiohead', album: 'Kid A' },
      source: {
        acquisitionId: 'acq-1',
        candidate: { username: 'peer1', path: 'peer1/x', sizeBytes: 1000 },
        feedPosition: 1,
      },
    });
  });

  it('a candidate-less delivery still imports, without retained provenance detail', async () => {
    const wiring = testWiring();
    const consume = consumer(wiring);

    const outcome = await consume(fulfilledEvent({ candidate: undefined }));

    expect(outcome.isOk()).toBe(true);
    expect(wiring.store.all()[0]?.type).toBe('ImportRequested');
  });

  it('acknowledges and ignores events of other types', async () => {
    const wiring = testWiring();
    const consume = consumer(wiring);

    const outcome = await consume(fulfilledEvent({ type: 'acquisition.progressed' }));

    expect(outcome.isOk()).toBe(true);
    expect(wiring.store.all()).toHaveLength(0);
  });

  it('a redelivered acquisition converges without a duplicate import', async () => {
    const wiring = testWiring();
    const consume = consumer(wiring);
    await consume(fulfilledEvent());
    wiring.sync();
    const before = wiring.store.all().length;

    const again = await consume(fulfilledEvent());

    expect(again.isOk()).toBe(true);
    expect(wiring.store.all()).toHaveLength(before);
  });

  // The review-resolution revival loop's last hop (e2e-review-resolution-loop): after a
  // reject-unusable-delivery verdict the downloader re-hunts and delivers a REPLACEMENT under
  // the same acquisition — a NEW event at a later feed position. The originating-download-id convergence
  // must not swallow it; everything at or before the cycle's watermark still converges. Pinned
  // out-of-process by test/e2e/review-resolution.e2e.test.ts.

  /** Given: a first delivery consumed (feed position 1) whose import cycle settled rejected. */
  async function givenARejectedFirstDelivery(wiring: TestWiring): Promise<void> {
    const consume = consumer(wiring);
    await consume(fulfilledEvent());
    const importId = importIdFor(`${INTAKE_ROOT}/Radiohead - Kid A`);
    const appended = await wiring.store.append(
      importId,
      1,
      [{ type: 'ImportRejected', reason: 'unusable delivery', filesDeleted: true }],
      appendMetadata(importId, 'T1'),
    );
    appended._unsafeUnwrap();
    wiring.sync();
  }

  it('a replacement delivery after a rejected import starts a fresh import cycle', async () => {
    const wiring = testWiring();
    await givenARejectedFirstDelivery(wiring);

    const replacement = await consumer(wiring)(
      fulfilledEvent({ candidate: { username: 'peer2', path: 'peer2/y', sizeBytes: 2000 } }, 2),
    );

    expect(replacement.isOk()).toBe(true);
    const requested = wiring.store.all().filter((entry) => entry.type === 'ImportRequested');
    expect(requested).toHaveLength(2);
    expect(requested[1]?.event).toMatchObject({
      source: {
        acquisitionId: 'acq-1',
        candidate: { username: 'peer2', path: 'peer2/y', sizeBytes: 2000 },
        feedPosition: 2,
      },
    });
  });

  it('a redelivery of the rejected delivery itself still converges', async () => {
    const wiring = testWiring();
    await givenARejectedFirstDelivery(wiring);
    const before = wiring.store.all().length;

    const again = await consumer(wiring)(fulfilledEvent());

    expect(again.isOk()).toBe(true);
    expect(wiring.store.all()).toHaveLength(before);
  });

  it('a new delivery holds while the current cycle has not settled', async () => {
    // The pending-rejection window (and any live cycle): converging would acknowledge — and
    // permanently drop — a delivery; the hold lets redelivery land it once the cycle settles.
    const wiring = testWiring();
    const consume = consumer(wiring);
    await consume(fulfilledEvent());
    wiring.sync();
    const before = wiring.store.all().length;

    const outcome = await consume(
      fulfilledEvent({ candidate: { username: 'peer2', path: 'peer2/y', sizeBytes: 2000 } }, 2),
    );

    expect(outcome._unsafeUnwrapErr()).toEqual({
      kind: 'Transient',
      reason: 'ExistingCycleNotSettled:acq-1',
    });
    expect(wiring.store.all()).toHaveLength(before);
  });

  it('a replay of a strictly earlier position converges — a full feed replay is a no-op', async () => {
    const wiring = testWiring();
    await givenARejectedFirstDelivery(wiring);
    const consume = consumer(wiring);
    // The replacement (position 2) starts the second cycle; the projection then reflects it.
    await consume(
      fulfilledEvent({ candidate: { username: 'peer2', path: 'peer2/y', sizeBytes: 2000 } }, 2),
    );
    wiring.sync();
    const before = wiring.store.all().length;

    const replayed = await consume(fulfilledEvent());

    expect(replayed.isOk()).toBe(true);
    expect(wiring.store.all()).toHaveLength(before);
  });

  it('a stale projection cannot make the seam drop a delivery — the decider refuses instead', async () => {
    // Divergence drill: the projection still shows the settled FIRST cycle while the store
    // already holds the live second cycle. The consumer's fast-path lets the newer event
    // through; the decider re-derives from the store and refuses (CycleInFlight), so the
    // outcome is a transient hold — never an acknowledgement that drops the delivery.
    const wiring = testWiring();
    await givenARejectedFirstDelivery(wiring);
    const consume = consumer(wiring);
    await consume(
      fulfilledEvent({ candidate: { username: 'peer2', path: 'peer2/y', sizeBytes: 2000 } }, 2),
    );
    // Deliberately NO sync: the projection still believes cycle one (settled, watermark 1).
    const before = wiring.store.all().length;

    const outcome = await consume(
      fulfilledEvent({ candidate: { username: 'peer3', path: 'peer3/z', sizeBytes: 3000 } }, 3),
    );

    expect(outcome._unsafeUnwrapErr()).toEqual({ kind: 'Transient', reason: 'CycleInFlight' });
    expect(wiring.store.all()).toHaveLength(before);
  });

  it('a manual resubmission does not erase the watermark — the next replacement still lands', async () => {
    const wiring = testWiring();
    await givenARejectedFirstDelivery(wiring);
    // An operator manually resubmits the same directory (no seam source), and that cycle is
    // later rejected too.
    const importId = importIdFor(`${INTAKE_ROOT}/Radiohead - Kid A`);
    await submitImport(
      wiring.deps,
      { directory: `${INTAKE_ROOT}/Radiohead - Kid A` },
      testContext(),
    );
    const rerejected = await wiring.store.append(
      importId,
      3,
      [{ type: 'ImportRejected', reason: 'still wrong', filesDeleted: true }],
      appendMetadata(importId, 'T2'),
    );
    rerejected._unsafeUnwrap();
    wiring.sync();

    const replacement = await consumer(wiring)(
      fulfilledEvent({ candidate: { username: 'peer2', path: 'peer2/y', sizeBytes: 2000 } }, 2),
    );

    expect(replacement.isOk()).toBe(true);
    const requested = wiring.store.all().filter((entry) => entry.type === 'ImportRequested');
    expect(requested).toHaveLength(3);
    expect(requested[2]?.event).toMatchObject({ source: { feedPosition: 2 } });
  });

  it('names the dead-lettered case in the hold reason — the wedge is self-describing', async () => {
    const wiring = testWiring();
    const consume = consumer(wiring);
    await consume(fulfilledEvent());
    wiring.sync();
    wiring.stalled.mark(importIdFor(`${INTAKE_ROOT}/Radiohead - Kid A`));

    const outcome = await consume(
      fulfilledEvent({ candidate: { username: 'peer2', path: 'peer2/y', sizeBytes: 2000 } }, 2),
    );

    expect(outcome._unsafeUnwrapErr()).toEqual({
      kind: 'Transient',
      reason: 'ExistingCycleStalled:acq-1',
    });
  });

  it('an import without a watermark converges every redelivery — the pre-watermark behavior', async () => {
    const wiring = testWiring();
    await submitImport(
      wiring.deps,
      {
        directory: `${INTAKE_ROOT}/Radiohead - Kid A`,
        source: { acquisitionId: toOriginatingDownloadId('acq-1') },
      },
      testContext(),
    );
    wiring.sync();
    const before = wiring.store.all().length;

    const outcome = await consumer(wiring)(fulfilledEvent({}, 5));

    expect(outcome.isOk()).toBe(true);
    expect(wiring.store.all()).toHaveLength(before);
  });

  it('the pre-watermark convergence announces itself — the one deliberate drop is never silent', async () => {
    const wiring = testWiring();
    await submitImport(
      wiring.deps,
      {
        directory: `${INTAKE_ROOT}/Radiohead - Kid A`,
        source: { acquisitionId: toOriginatingDownloadId('acq-1') },
      },
      testContext(),
    );
    wiring.sync();
    const warnings: { context: Record<string, unknown>; message: string }[] = [];
    const consume = consumer(wiring, {
      warn: (context, message) => {
        warnings.push({ context, message });
      },
    });

    await consume(fulfilledEvent({}, 5));

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.context).toMatchObject({ acquisitionId: 'acq-1', globalSeq: 5 });
    expect(warnings[0]?.message).toContain('resubmit');
  });

  it('a malformed payload of the known type is a permanent (poison) failure', async () => {
    const wiring = testWiring();
    const consume = consumer(wiring);

    const outcome = await consume(fulfilledEvent({ location: '' }));

    expect(outcome._unsafeUnwrapErr()).toEqual({ kind: 'Permanent', reason: 'InvalidPayload' });
  });

  it('a location outside the source root is a permanent rejection', async () => {
    const wiring = testWiring();
    const consume = consumer(wiring);

    const outcome = await consume(fulfilledEvent({ location: '/elsewhere/Radiohead - Kid A' }));

    expect(outcome._unsafeUnwrapErr()).toEqual({ kind: 'Permanent', reason: 'OutsideSourceRoot' });
    expect(wiring.store.all()).toHaveLength(0);
  });

  it('a not-yet-visible directory is transient so the seam redelivers', async () => {
    const wiring = testWiring();
    const consume = consumer(wiring, { directoryExists: () => Promise.resolve(false) });

    const outcome = await consume(fulfilledEvent());

    expect(outcome._unsafeUnwrapErr()).toEqual({
      kind: 'Transient',
      reason: `IntakeDirectoryMissing: ${INTAKE_ROOT}/Radiohead - Kid A`,
    });
    expect(wiring.store.all()).toHaveLength(0);
  });

  it('a faulting directory probe is a distinct transient fault, not "missing"', async () => {
    const wiring = testWiring();
    const consume = consumer(wiring, {
      directoryExists: () => Promise.reject(new Error('EACCES: permission denied')),
    });

    const outcome = await consume(fulfilledEvent());

    // A probe that throws (EACCES/EIO/…) must not masquerade as IntakeDirectoryMissing — it is
    // held under its own reason so a genuine infra fault is distinguishable in the logs.
    expect(outcome._unsafeUnwrapErr()).toEqual({
      kind: 'Transient',
      reason: 'IntakeProbeFailed: EACCES: permission denied',
    });
    expect(wiring.store.all()).toHaveLength(0);
  });

  it('a probe rejecting with a non-Error still carries its detail in the hold reason', async () => {
    const wiring = testWiring();
    const consume = consumer(wiring, {
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the vendor-shaped worst case
      directoryExists: () => Promise.reject('EIO'),
    });

    const outcome = await consume(fulfilledEvent());

    expect(outcome._unsafeUnwrapErr()).toEqual({
      kind: 'Transient',
      reason: 'IntakeProbeFailed: EIO',
    });
  });

  it('an append fault is transient, passing the append error kind through as the hold reason', async () => {
    const wiring = testWiring();
    wiring.store.failAppends = true;
    const consume = consumer(wiring);

    const outcome = await consume(fulfilledEvent());

    // The submission's sad path is an infra fault; its kind rides through as the transient reason.
    expect(outcome._unsafeUnwrapErr()).toEqual({ kind: 'Transient', reason: 'InfraError' });
  });

  it('an append race is transient too, passing the conflict kind through as the hold reason', async () => {
    const wiring = testWiring();
    wiring.store.conflictOnAppend = true;
    const consume = consumer(wiring);

    const outcome = await consume(fulfilledEvent());

    expect(outcome._unsafeUnwrapErr()).toEqual({
      kind: 'Transient',
      reason: 'ConcurrencyConflict',
    });
  });
});

describe('intake consumer — crossing the seam', () => {
  const DOWNLOADER_STORY = '00112233445566778899aabbccddeeff';

  it('adopts the producer story and points causation at the consumed event', async () => {
    const wiring = testWiring();
    const event: SeamEvent = {
      ...fulfilledEvent(),
      metadata: {
        correlationId: DOWNLOADER_STORY,
        causation: { kind: 'event', context: 'downloader', streamId: 'acq-1', version: 6 },
      },
    };

    const outcome = await consumer(wiring)(event);

    expect(outcome.isOk()).toBe(true);
    const appended = wiring.store.all();
    expect(appended.length).toBeGreaterThan(0);
    for (const entry of appended) {
      // Verbatim: the ACL translates the model, never the observability envelope.
      expect(entry.metadata.correlationId).toBe(DOWNLOADER_STORY);
      expect(entry.metadata.causation).toEqual({
        kind: 'event',
        context: 'downloader',
        streamId: 'acq-1',
        version: 6,
      });
    }
  });

  it('integrates an event with no metadata block unchanged, on a freshly minted story', async () => {
    const wiring = testWiring();

    const outcome = await consumer(wiring)(fulfilledEvent());

    expect(outcome.isOk()).toBe(true); // absence degrades the trace, never the work
    const appended = wiring.store.all();
    expect(appended.length).toBeGreaterThan(0);
    expect(appended[0]!.metadata.correlationId).toMatch(/^[0-9a-f]{32}$/);
    expect(appended[0]!.metadata.correlationId).not.toBe(DOWNLOADER_STORY);
  });

  it('announces an envelope it cannot read — that is producer drift, not history', async () => {
    const warned: { context: Record<string, unknown>; message: string }[] = [];
    const wiring = testWiring();
    const event: SeamEvent = { ...fulfilledEvent(), metadata: { correlationId: 42 } };

    await consumer(wiring, {
      warn: (context, message) => void warned.push({ context, message }),
    })(event);

    expect(warned.some((entry) => entry.message.includes('cannot read'))).toBe(true);
    // Which delivery drifted: an alert that cannot be traced back to a producer event and the
    // envelope it sent is one an operator can only shrug at.
    expect(warned[0]?.context).toMatchObject({ acquisitionId: 'acq-1', globalSeq: 1 });
    // And which FIELD drifted — the detail is the parse error, and naming the offending field is
    // the whole of its value to the reader. Asserting only that it is a string would be satisfied
    // by the empty one.
    expect(warned[0]?.context.detail).toContain('correlationId');
  });

  it('stays quiet when a producer simply sends no envelope — permanent and expected', async () => {
    const warned: { context: Record<string, unknown>; message: string }[] = [];
    const wiring = testWiring();

    await consumer(wiring, {
      warn: (context, message) => void warned.push({ context, message }),
    })(fulfilledEvent());

    expect(warned).toEqual([]);
  });

  it('reads an explicitly null envelope as no envelope at all — also quiet', async () => {
    // A producer that serializes an absent block as `null` has sent no block, not a broken one:
    // announcing it would blunt the one warning that means a LIVE producer has drifted.
    const warned: { context: Record<string, unknown>; message: string }[] = [];
    const wiring = testWiring();
    const event: SeamEvent = { ...fulfilledEvent(), metadata: null };

    const outcome = await consumer(wiring, {
      warn: (context, message) => void warned.push({ context, message }),
    })(event);

    expect(outcome.isOk()).toBe(true);
    expect(warned).toEqual([]);
    expect(wiring.store.all()[0]!.metadata.correlationId).toMatch(/^[0-9a-f]{32}$/);
  });

  it('mints fresh rather than trusting a malformed metadata block', async () => {
    const wiring = testWiring();
    const event: SeamEvent = { ...fulfilledEvent(), metadata: { correlationId: 42 } };

    const outcome = await consumer(wiring)(event);

    expect(outcome.isOk()).toBe(true);
    expect(wiring.store.all()[0]!.metadata.correlationId).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('the full circle — one story, downloader → importer → verdict → downloader', () => {
  const DOWNLOADER_STORY = '00112233445566778899aabbccddeeff';

  it('publishes the verdict under the story that crossed the seam inbound', async () => {
    const wiring = testWiring();
    // 1. The downloader's fulfilment arrives carrying its story; intake adopts it.
    await consumer(wiring)({
      ...fulfilledEvent(),
      metadata: {
        correlationId: DOWNLOADER_STORY,
        causation: { kind: 'event', context: 'downloader', streamId: 'acq-1', version: 6 },
      },
    });
    const importId = importIdFor(`${INTAKE_ROOT}/Radiohead - Kid A`);
    await wiring.dispatch(importId, {
      type: 'Propose',
      directory: `${INTAKE_ROOT}/Radiohead - Kid A`,
    });
    wiring.sync();

    // 2. A human rejects the delivery as unusable — the verb that mints a verdict for the sender.
    const resolved = await wiring.facade.resolveReview(
      { id: importId, resolution: { verb: 'reject-unusable-delivery', reasons: ['corrupt'] } },
      // A DIFFERENT request drives the resolution; its own story must NOT overwrite the operation's.
      'ffffffffffffffffffffffffffffffff',
    );
    expect(resolved.ok).toBe(true);

    // 3. The verdict renders onto the outbound feed still carrying the downloader's story.
    const stream = wiring.store.all().filter((entry) => entry.streamId === importId);
    const verdict = stream.find((entry) => entry.type === 'ReleaseVerdictRecorded');
    expect(verdict).toBeDefined();
    const rendered = publishedEventMapping.render(verdict!, stream)._unsafeUnwrap();
    expect(rendered.metadata).toMatchObject({ correlationId: DOWNLOADER_STORY });
  });
});

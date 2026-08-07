import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  contextForDelivery,
  verdictToFailureInput,
} from '../../src/interfaces/contracts/verdicts/mapping.js';
import { fixedCorrelation } from '../../src/application/__fixtures__/correlation.js';
import { externalVerdictDeliverySchema } from '../../src/interfaces/contracts/verdicts/schemas.js';

/**
 * Consumer-driven contract over the importer module's `release.verdict` event
 * (merge-modular-monolith 3.8): the PRODUCER's frozen recorded fixture — read straight from the
 * importer package, in the same repo and gate — must parse through this module's tolerant reader
 * and yield exactly the fields the downloader consumes. Any producer reshaping that touches a
 * read field fails this gate before it can merge; everything else is ignored by design.
 * (Cross-package fixture reads are a test-tier affair; the no-shared-kernel rule governs src.)
 */

const FIXTURE = new URL(
  '../../../importer/test/contract/fixtures/events/release.verdict/v1.json',
  import.meta.url,
).pathname;

interface RecordedDelivery {
  readonly provenance: { readonly schemaVersion: number };
  readonly event: { readonly type: string; readonly data: unknown };
}

const recorded = JSON.parse(readFileSync(FIXTURE, 'utf8')) as RecordedDelivery;

describe('the recorded release.verdict fixture', () => {
  it('is the schema version this reader was written against', () => {
    expect(recorded.provenance.schemaVersion).toBe(1);
  });

  it('carries the type the subscription dispatches on', () => {
    expect(recorded.event.type).toBe('release.verdict');
  });

  it('parses through the tolerant reader, ignoring everything the downloader does not use', () => {
    const parsed = externalVerdictDeliverySchema.parse(recorded.event);
    expect(parsed).toEqual({
      data: {
        acquisitionId: 'acq-1',
        candidate: {
          username: 'peer1',
          path: 'peer1/Artist - Album [FLAC]',
          sizeBytes: 123_456,
        },
        verdict: 'rejected',
        reasons: ['corrupt rip', 'transcoded from lossy'],
      },
    });
  });

  it('translates to exactly the native external-validation input', () => {
    const input = verdictToFailureInput(externalVerdictDeliverySchema.parse(recorded.event));
    expect(input).toEqual({
      acquisitionId: 'acq-1',
      candidate: {
        username: 'peer1',
        path: 'peer1/Artist - Album [FLAC]',
        sizeBytes: 123_456,
      },
      reasons: ['corrupt rip', 'transcoded from lossy'],
    });
  });
});

/**
 * The correlation envelope, proved against the PRODUCER's own recorded bytes.
 *
 * The producer's `publishedCorrelationSchema` and this module's `inboundCorrelationSchema` are two
 * independently hand-authored zod schemas that no type connects. Until this test they were pinned
 * only against each other's authors' intentions: the producer suite asserted what it renders, the
 * consumer suite asserted a hand-written literal, and a drift between them would have left both
 * green while every cross-context trace silently detached — because `contextForDelivery` swallows
 * an unreadable envelope into a fresh story by design.
 */
const recordedV2 = JSON.parse(
  readFileSync(
    new URL(
      '../../../importer/test/contract/fixtures/events/release.verdict/v2.json',
      import.meta.url,
    ).pathname,
    'utf8',
  ),
) as RecordedDelivery & { readonly event: { readonly metadata?: unknown } };

describe('the recorded release.verdict fixture carrying correlation metadata', () => {
  it('is the schema version that first published the envelope', () => {
    expect(recordedV2.provenance.schemaVersion).toBe(2);
  });

  it('still parses through the tolerant reader — the envelope is additive to the payload', () => {
    expect(() => externalVerdictDeliverySchema.parse(recordedV2.event)).not.toThrow();
  });

  it('adopts the producer story verbatim, with causation naming the consumed event', () => {
    const context = contextForDelivery(recordedV2.event.metadata, fixedCorrelation(), () =>
      expect.unreachable("the producer's own bytes must be readable by this consumer"),
    );

    expect(context.correlationId).toBe('9f2c1d4e6a7b8c9d0e1f2a3b4c5d6e7f');
    expect(context.causation).toEqual({
      kind: 'event',
      context: 'importer',
      streamId: 'e3a1b2c4-5d6e-4f70-8a9b-0c1d2e3f4a5b',
      version: 4,
    });
  });

  it('mints its own story from the v1 fixture, which predates the envelope', () => {
    const context = contextForDelivery(
      (recorded.event as { metadata?: unknown }).metadata,
      fixedCorrelation(),
      () => expect.unreachable('an ABSENT envelope is expected history, not a drift signal'),
    );

    expect(context.causation).toMatchObject({ kind: 'command' });
  });
});

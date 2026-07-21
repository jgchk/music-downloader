import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { verdictToFailureInput } from '../../src/interfaces/contracts/verdicts/mapping.js';
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
          sizeBytes: 123456,
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
        sizeBytes: 123456,
      },
      reasons: ['corrupt rip', 'transcoded from lossy'],
    });
  });
});

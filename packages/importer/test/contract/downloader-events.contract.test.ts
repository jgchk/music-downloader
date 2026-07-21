import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fulfilledToSubmission } from '../../src/interfaces/contracts/intake/mapping.js';
import {
  acquisitionFulfilledSchema,
  intakeEventEnvelopeSchema,
} from '../../src/interfaces/contracts/intake/schemas.js';

/**
 * Consumer-driven contract over the downloader module's `acquisition.fulfilled` event
 * (merge-modular-monolith 3.8): the PRODUCER's frozen recorded fixture — read straight from the
 * downloader package, in the same repo and gate — must parse through this module's tolerant
 * reader and yield exactly the fields the importer consumes. Any producer reshaping that touches
 * a read field fails this gate before it can merge; everything else is ignored by design.
 * (Cross-package fixture reads are a test-tier affair; the no-shared-kernel rule governs src.)
 */

const FIXTURE = new URL(
  '../../../downloader/test/contract/fixtures/events/acquisition.fulfilled/v1.json',
  import.meta.url,
).pathname;

interface RecordedDelivery {
  readonly provenance: { readonly schemaVersion: number };
  readonly event: unknown;
}

const recorded = JSON.parse(readFileSync(FIXTURE, 'utf8')) as RecordedDelivery;

describe('the recorded acquisition.fulfilled fixture', () => {
  it('is the schema version this reader was written against', () => {
    expect(recorded.provenance.schemaVersion).toBe(1);
  });

  it('dispatches through the envelope reader', () => {
    expect(intakeEventEnvelopeSchema.parse(recorded.event)).toEqual({
      type: 'acquisition.fulfilled',
    });
  });

  it('parses through the tolerant reader, ignoring everything the importer does not use', () => {
    const parsed = acquisitionFulfilledSchema.parse(recorded.event);
    expect(parsed).toEqual({
      type: 'acquisition.fulfilled',
      data: {
        acquisitionId: '1e6cbf59-7f3f-4b39-8ad9-0d84b3d5c5f4',
        location: '/library/Radiohead/Kid A (2000)',
        target: {
          type: 'album',
          artist: 'Radiohead',
          title: 'Kid A',
          musicbrainzReleaseId: '6e335887-60ba-38f0-95af-fae8774d20fd',
        },
        candidate: {
          username: 'peer1',
          path: 'peer1/Radiohead - Kid A (2000) [FLAC]',
          sizeBytes: 1000,
        },
      },
    });
  });

  it('translates to exactly the native submission the receiver would make', () => {
    const submission = fulfilledToSubmission(acquisitionFulfilledSchema.parse(recorded.event));
    expect(submission).toEqual({
      acquisitionId: '1e6cbf59-7f3f-4b39-8ad9-0d84b3d5c5f4',
      location: '/library/Radiohead/Kid A (2000)',
      hints: {
        mbReleaseId: '6e335887-60ba-38f0-95af-fae8774d20fd',
        artist: 'Radiohead',
        album: 'Kid A',
      },
      // The retained candidate a later release verdict must echo (the sender's stale-guard key).
      candidate: {
        username: 'peer1',
        path: 'peer1/Radiohead - Kid A (2000) [FLAC]',
        sizeBytes: 1000,
      },
    });
  });
});

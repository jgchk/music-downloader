import { describe, expect, it } from 'vitest';
import { acquisitionStatusResponseSchema, submitAcquisitionRequestSchema } from './schemas.js';

describe('submitAcquisitionRequestSchema', () => {
  it('accepts a MusicBrainz request with optional policies', () => {
    const parsed = submitAcquisitionRequestSchema.parse({
      request: { kind: 'musicbrainz', mbid: 'rel-1', targetType: 'album' },
      matchPolicy: { threshold: 0.8 },
    });

    expect(parsed.request).toMatchObject({ kind: 'musicbrainz', mbid: 'rel-1' });
  });

  it('accepts a descriptor request', () => {
    const parsed = submitAcquisitionRequestSchema.parse({
      request: { kind: 'descriptor', targetType: 'track', artist: 'A', title: 'T' },
    });

    expect(parsed.request).toMatchObject({ kind: 'descriptor', artist: 'A' });
  });

  it('rejects an unknown request kind', () => {
    expect(() =>
      submitAcquisitionRequestSchema.parse({ request: { kind: 'torrent', mbid: 'x' } }),
    ).toThrow();
  });

  it('rejects a match threshold outside [0, 1]', () => {
    expect(() =>
      submitAcquisitionRequestSchema.parse({
        request: { kind: 'musicbrainz', mbid: 'rel-1', targetType: 'album' },
        matchPolicy: { threshold: 2 },
      }),
    ).toThrow();
  });
});

describe('acquisitionStatusResponseSchema', () => {
  it('validates a status view with a mixed history', () => {
    const candidate = { username: 'u1', path: 'p', sizeBytes: 100 };
    const parsed = acquisitionStatusResponseSchema.parse({
      acquisitionId: 'acq-1',
      status: 'Downloading',
      currentCandidate: candidate,
      attempts: 2,
      rejectedCount: 1,
      history: [
        { kind: 'selected', candidate },
        { kind: 'download-failed', candidate, reason: 'Stalled' },
        { kind: 'validation-failed', candidate, reasons: ['Unplayable'] },
        { kind: 'imported', candidate, location: '/lib/a' },
        { kind: 'fulfillment-rejected', candidate, reasons: ['corrupt stub'] },
      ],
    });

    expect(parsed.history).toHaveLength(5);
  });

  it('rejects an unknown status', () => {
    expect(() =>
      acquisitionStatusResponseSchema.parse({
        acquisitionId: 'a',
        status: 'Bogus',
        attempts: 0,
        rejectedCount: 0,
        history: [],
      }),
    ).toThrow();
  });
});

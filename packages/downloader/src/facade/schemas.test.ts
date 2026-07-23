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

  it('accepts a release-group request (album only)', () => {
    const parsed = submitAcquisitionRequestSchema.parse({
      request: { kind: 'release-group', mbid: 'rg-1', targetType: 'album' },
    });

    expect(parsed.request).toMatchObject({ kind: 'release-group', mbid: 'rg-1' });
  });

  it('rejects a release-group request targeting a track', () => {
    expect(() =>
      submitAcquisitionRequestSchema.parse({
        request: { kind: 'release-group', mbid: 'rg-1', targetType: 'track' },
      }),
    ).toThrow();
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
        { kind: 'selected', at: '2026-01-01T00:00:00Z', candidate },
        { kind: 'download-failed', at: '2026-01-01T00:00:01Z', candidate, reason: 'Stalled' },
        {
          kind: 'validation-failed',
          at: '2026-01-01T00:00:02Z',
          candidate,
          reasons: ['Unplayable'],
        },
        { kind: 'imported', at: '2026-01-01T00:00:03Z', candidate, location: '/lib/a' },
        {
          kind: 'fulfillment-rejected',
          at: '2026-01-01T00:00:04Z',
          candidate,
          reasons: ['corrupt stub'],
        },
      ],
    });

    expect(parsed.history).toHaveLength(5);
    expect(parsed.history[0]).toMatchObject({ at: '2026-01-01T00:00:00Z' });
  });

  it('accepts the additive stalled flag and its absence (reactor-durability D2)', () => {
    const base = {
      acquisitionId: 'acq-1',
      status: 'Downloading',
      attempts: 0,
      rejectedCount: 0,
      history: [],
    };
    expect(acquisitionStatusResponseSchema.parse(base).stalled).toBeUndefined();
    expect(acquisitionStatusResponseSchema.parse({ ...base, stalled: true }).stalled).toBe(true);
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

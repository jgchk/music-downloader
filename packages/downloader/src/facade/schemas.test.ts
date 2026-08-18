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
        { kind: 'download-started', at: '2026-01-01T00:00:00.500Z', candidate },
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

    expect(parsed.history).toHaveLength(6);
    expect(parsed.history[0]).toMatchObject({ at: '2026-01-01T00:00:00Z' });
  });

  it('validates the additive lifecycle history kinds (legible-acquisition-history)', () => {
    const at = '2026-01-01T00:00:00Z';
    const parsed = acquisitionStatusResponseSchema.parse({
      acquisitionId: 'acq-1',
      status: 'Fulfilled',
      attempts: 1,
      rejectedCount: 0,
      history: [
        {
          kind: 'requested',
          at,
          request: { kind: 'musicbrainz', mbid: 'rel-1', targetType: 'album' },
        },
        { kind: 'resolved', at, artist: 'Artist', title: 'Album', year: 1975 },
        { kind: 'search-started', at, round: 1 },
        { kind: 'fulfilled', at, location: '/lib/a' },
        { kind: 'exhausted', at },
        { kind: 'conflicted', at, location: '/lib/occupied' },
        { kind: 'metadata-failed', at },
        { kind: 'cancelled', at },
      ],
    });

    expect(parsed.history.map((entry) => entry.kind)).toEqual([
      'requested',
      'resolved',
      'search-started',
      'fulfilled',
      'exhausted',
      'conflicted',
      'metadata-failed',
      'cancelled',
    ]);
  });

  it('accepts a resolved entry without a year', () => {
    const parsed = acquisitionStatusResponseSchema.parse({
      acquisitionId: 'acq-1',
      status: 'Searching',
      attempts: 0,
      rejectedCount: 0,
      history: [{ kind: 'resolved', at: '2026-01-01T00:00:00Z', artist: 'A', title: 'T' }],
    });
    expect(parsed.history[0]).toMatchObject({ kind: 'resolved', artist: 'A' });
  });

  it('accepts the additive requestedTarget echo and its absence', () => {
    const base = {
      acquisitionId: 'acq-1',
      status: 'MetadataFailed',
      attempts: 0,
      rejectedCount: 0,
      history: [],
    };
    expect(acquisitionStatusResponseSchema.parse(base).requestedTarget).toBeUndefined();
    const parsed = acquisitionStatusResponseSchema.parse({
      ...base,
      requestedTarget: { kind: 'descriptor', targetType: 'album', artist: 'A', title: 'T' },
    });
    expect(parsed.requestedTarget).toMatchObject({ kind: 'descriptor', artist: 'A' });
  });

  it('accepts the additive requestedAt stamp and its absence', () => {
    const base = {
      acquisitionId: 'acq-1',
      status: 'Pending',
      attempts: 0,
      rejectedCount: 0,
      history: [],
    };
    expect(acquisitionStatusResponseSchema.parse(base).requestedAt).toBeUndefined();
    const parsed = acquisitionStatusResponseSchema.parse({
      ...base,
      requestedAt: '2026-01-01T00:00:00Z',
    });
    expect(parsed.requestedAt).toBe('2026-01-01T00:00:00Z');
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

  it('rejects a stalled: false the producer never emits (tag-or-omit)', () => {
    const base = {
      acquisitionId: 'acq-1',
      status: 'Downloading',
      attempts: 0,
      rejectedCount: 0,
      history: [],
    };
    expect(acquisitionStatusResponseSchema.safeParse({ ...base, stalled: false }).success).toBe(
      false,
    );
  });

  it('accepts the additive lifecycle flags present (true/false) and absent', () => {
    const base = {
      acquisitionId: 'acq-1',
      status: 'Downloading',
      attempts: 0,
      rejectedCount: 0,
      history: [],
    };
    const absent = acquisitionStatusResponseSchema.parse(base);
    expect(absent.cancellable).toBeUndefined();
    expect(absent.awaitingSelection).toBeUndefined();

    const cancellable = acquisitionStatusResponseSchema.parse({
      ...base,
      cancellable: true,
      awaitingSelection: true,
    });
    expect(cancellable.cancellable).toBe(true);
    expect(cancellable.awaitingSelection).toBe(true);

    const terminal = acquisitionStatusResponseSchema.parse({
      ...base,
      cancellable: false,
      awaitingSelection: false,
    });
    expect(terminal.cancellable).toBe(false);
    expect(terminal.awaitingSelection).toBe(false);
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

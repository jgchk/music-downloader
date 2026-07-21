import { describe, expect, it } from 'vitest';
import { submitAcquisitionRequestSchema } from '@music/downloader';
import { resolveReviewRequestSchema } from '@music/importer';
import { resolveReviewForm, submitAcquisitionForm, submitFormValues } from './forms.js';

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(entries)) data.set(k, v);
  return data;
}

describe('submitAcquisitionForm', () => {
  it('shapes a musicbrainz request with no policies', () => {
    const dto = submitAcquisitionForm(
      form({ kind: 'musicbrainz', mbid: 'mb-1', targetType: 'album' }),
    );
    expect(submitAcquisitionRequestSchema.parse(dto)).toEqual({
      request: { kind: 'musicbrainz', mbid: 'mb-1', targetType: 'album' },
    });
  });

  it('shapes a descriptor request with optional album omitted when blank', () => {
    const dto = submitAcquisitionForm(
      form({ kind: 'descriptor', targetType: 'track', artist: 'A', title: 'T', album: ' ' }),
    );
    expect(submitAcquisitionRequestSchema.parse(dto)).toEqual({
      request: { kind: 'descriptor', targetType: 'track', artist: 'A', title: 'T' },
    });
  });

  it('shapes every optional policy when provided', () => {
    const dto = submitAcquisitionForm(
      form({
        kind: 'musicbrainz',
        mbid: 'mb-1',
        targetType: 'album',
        qualityFloor: 'LOSSY_HIGH',
        qualityOrder: 'LOSSLESS, LOSSY_HIGH',
        matchThreshold: '0.7',
        maxSearchRounds: '2',
        maxTotalAttempts: '5',
        timeBudgetMs: '60000',
        stallTimeoutMs: '30000',
        maxQueueWaitMs: '20000',
      }),
    );
    expect(submitAcquisitionRequestSchema.parse(dto)).toEqual({
      request: { kind: 'musicbrainz', mbid: 'mb-1', targetType: 'album' },
      qualityPolicy: { order: ['LOSSLESS', 'LOSSY_HIGH'], floor: 'LOSSY_HIGH' },
      matchPolicy: { threshold: 0.7 },
      retryPolicy: { maxSearchRounds: 2, maxTotalAttempts: 5, timeBudgetMs: 60000 },
      downloadPolicy: { stallTimeoutMs: 30000, maxQueueWaitMs: 20000 },
    });
  });

  it('passes malformed input through for the facade to refuse', () => {
    const dto = submitAcquisitionForm(form({ kind: 'musicbrainz', targetType: 'album' }));
    expect(submitAcquisitionRequestSchema.safeParse(dto).success).toBe(false);
  });

  it('echoes typed values for repopulation, skipping non-string entries', () => {
    const data = form({ kind: 'descriptor', artist: 'A' });
    data.set('upload', new File(['x'], 'x.txt'));
    expect(submitFormValues(data)).toEqual({ kind: 'descriptor', artist: 'A' });
  });
});

describe('resolveReviewForm', () => {
  it('shapes apply-candidate with an optional duplicate action', () => {
    const dto = resolveReviewForm(
      form({
        verb: 'apply-candidate',
        dataSource: 'MusicBrainz',
        albumId: 'r-1',
        duplicateAction: 'replace',
      }),
    );
    expect(resolveReviewRequestSchema.parse(dto)).toEqual({
      verb: 'apply-candidate',
      candidate: { dataSource: 'MusicBrainz', albumId: 'r-1' },
      duplicateAction: 'replace',
    });
  });

  it('shapes supply-id', () => {
    expect(
      resolveReviewRequestSchema.parse(
        resolveReviewForm(form({ verb: 'supply-id', mbReleaseId: 'mb-9' })),
      ),
    ).toEqual({ verb: 'supply-id', mbReleaseId: 'mb-9' });
  });

  it('shapes manual-tags with indexed track rows', () => {
    const dto = resolveReviewForm(
      form({
        verb: 'manual-tags',
        albumArtist: 'A',
        album: 'L',
        year: '1999',
        'tracks.0.path': '/in/01.flac',
        'tracks.0.title': 'One',
        'tracks.0.trackNumber': '1',
        'tracks.1.path': '/in/02.flac',
        'tracks.1.title': 'Two',
        'tracks.1.artist': 'Feat',
        'tracks.1.trackNumber': '2',
        'tracks.1.discNumber': '1',
      }),
    );
    expect(resolveReviewRequestSchema.parse(dto)).toEqual({
      verb: 'manual-tags',
      tags: {
        albumArtist: 'A',
        album: 'L',
        year: 1999,
        tracks: [
          { path: '/in/01.flac', title: 'One', trackNumber: 1 },
          { path: '/in/02.flac', title: 'Two', artist: 'Feat', trackNumber: 2, discNumber: 1 },
        ],
      },
    });
  });

  it('shapes reject with and without a reason', () => {
    expect(resolveReviewRequestSchema.parse(resolveReviewForm(form({ verb: 'reject' })))).toEqual({
      verb: 'reject',
    });
    expect(
      resolveReviewRequestSchema.parse(
        resolveReviewForm(form({ verb: 'reject', reason: 'wrong album' })),
      ),
    ).toEqual({ verb: 'reject', reason: 'wrong album' });
  });

  it('shapes reject-and-retry-download with newline-separated reasons', () => {
    expect(
      resolveReviewRequestSchema.parse(
        resolveReviewForm(
          form({ verb: 'reject-and-retry-download', reasons: 'clipped\n\ntranscode' }),
        ),
      ),
    ).toEqual({ verb: 'reject-and-retry-download', reasons: ['clipped', 'transcode'] });
  });

  it('shapes the payload-free verbs', () => {
    for (const verb of ['refresh-candidates', 'import-as-is', 'accept', 'retry-enrichment']) {
      expect(resolveReviewRequestSchema.parse(resolveReviewForm(form({ verb })))).toEqual({ verb });
    }
  });

  it('passes an unknown verb through for the facade to refuse', () => {
    expect(
      resolveReviewRequestSchema.safeParse(resolveReviewForm(form({ verb: 'nope' }))).success,
    ).toBe(false);
  });
});

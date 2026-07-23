import { describe, expect, it } from 'vitest';
import {
  DIRECTORY,
  FAILURE,
  INCUMBENT,
  candidate,
} from '../domain/import/__fixtures__/import-fixtures.js';
import type { ImportStatusView } from '../application/projections/read-models.js';
import { asDistance } from '../domain/shared/__fixtures__/distance.js';
import { toImportId } from '../domain/shared/import-id.js';
import {
  hintsToDomain,
  pendingReviewToDto,
  resolutionToDomain,
  reviewToDto,
  statusViewToDto,
} from './mapping.js';

describe('hintsToDomain', () => {
  it('maps supplied hints and passes through absence', () => {
    expect(hintsToDomain({ path: '/a' })).toBeUndefined();
    expect(
      hintsToDomain({ path: '/a', hints: { mbReleaseId: 'mb-1', artist: 'A', album: 'B' } }),
    ).toEqual({ mbReleaseId: 'mb-1', artist: 'A', album: 'B' });
  });
});

describe('resolutionToDomain', () => {
  it('maps every verb to its domain resolution', () => {
    expect(
      resolutionToDomain({
        verb: 'apply-candidate',
        candidate: { dataSource: 'MusicBrainz', albumId: 'a1' },
        duplicateAction: 'keep-both',
      }),
    ).toEqual({
      kind: 'apply-candidate',
      ref: { dataSource: 'MusicBrainz', albumId: 'a1' },
      duplicateAction: 'keep-both',
    });
    expect(resolutionToDomain({ verb: 'supply-id', mbReleaseId: 'mb-2' })).toEqual({
      kind: 'supply-id',
      mbReleaseId: 'mb-2',
    });
    expect(resolutionToDomain({ verb: 'refresh-candidates' })).toEqual({
      kind: 'refresh-candidates',
    });
    const tags = {
      albumArtist: 'A',
      album: 'B',
      tracks: [
        { path: 'a.mp3', title: 'T', trackNumber: 1, discNumber: 2 },
        { path: 'b.mp3', title: 'U', trackNumber: 2 },
      ],
    };
    expect(resolutionToDomain({ verb: 'manual-tags', tags })).toEqual({
      kind: 'manual-tags',
      tags,
    });
    expect(resolutionToDomain({ verb: 'import-as-is' })).toEqual({ kind: 'import-as-is' });
    expect(resolutionToDomain({ verb: 'reject', reason: 'r' })).toEqual({
      kind: 'reject',
      reason: 'r',
    });
    expect(
      resolutionToDomain({ verb: 'reject-and-retry-download', reasons: ['corrupt rip'] }),
    ).toEqual({ kind: 'reject-and-retry-download', reasons: ['corrupt rip'] });
    expect(resolutionToDomain({ verb: 'accept' })).toEqual({ kind: 'accept' });
    expect(resolutionToDomain({ verb: 'retry-enrichment' })).toEqual({ kind: 'retry-enrichment' });
  });
});

describe('reviewToDto', () => {
  it('embeds the candidate list on match and duplicate reviews', () => {
    expect(
      reviewToDto({
        cause: { kind: 'match-review', hinted: true, best: candidate().ref },
        candidates: [candidate()],
      }),
    ).toEqual({
      kind: 'match-review',
      hinted: true,
      best: candidate().ref,
      candidates: [candidate()],
    });
    expect(
      reviewToDto({
        cause: { kind: 'duplicate-review', incumbents: [INCUMBENT] },
        candidates: [candidate()],
      }),
    ).toEqual({ kind: 'duplicate-review', incumbents: [INCUMBENT], candidates: [candidate()] });
  });

  it('carries the pinned/hinted release id and each candidate’s field-level diff evidence', () => {
    const enriched = candidate({
      tracks: [
        {
          path: `${DIRECTORY}/01 Track.flac`,
          title: 'Track',
          index: 1,
          current: { title: 'Trakk', artist: 'Artist', track: 1, length: 200 },
          distance: asDistance(0.2),
        },
      ],
      extraItems: [{ path: `${DIRECTORY}/99 Extra.flac`, title: 'Extra', track: 9 }],
      missingTracks: [{ title: 'Absent', index: 2 }],
      albumFields: {
        year: 2020,
        media: 'CD',
        label: 'Label',
        catalognum: 'CAT1',
        country: 'US',
        albumDisambig: 'deluxe',
      },
    });
    const dto = reviewToDto({
      cause: {
        kind: 'match-review',
        hinted: true,
        hintedReleaseId: 'mb-release-1',
        best: enriched.ref,
      },
      candidates: [enriched],
    });
    expect(dto).toEqual({
      kind: 'match-review',
      hinted: true,
      hintedReleaseId: 'mb-release-1',
      best: enriched.ref,
      candidates: [enriched],
    });
  });

  it('maps an unhinted match review, no-match, and remediation', () => {
    const best = { dataSource: 'MusicBrainz', albumId: 'album-9' };
    expect(
      reviewToDto({ cause: { kind: 'match-review', hinted: false, best }, candidates: [] }),
    ).toEqual({ kind: 'match-review', hinted: false, best, candidates: [] });
    expect(reviewToDto({ cause: { kind: 'no-match' }, candidates: [] })).toEqual({
      kind: 'no-match',
    });
    expect(
      reviewToDto({ cause: { kind: 'remediation-review', failures: [FAILURE] }, candidates: [] }),
    ).toEqual({ kind: 'remediation-review', failures: [FAILURE] });
  });
});

describe('statusViewToDto / pendingReviewToDto', () => {
  const view: ImportStatusView = {
    importId: toImportId('imp-1'),
    acquisitionId: 'acq-1',
    directory: DIRECTORY,
    phase: 'rejected',
    rejection: { reason: 'r', filesDeleted: true },
    history: [{ kind: 'rejected', at: 't', reason: 'r', filesDeleted: true }],
  };

  it('maps a status view onto the wire shape, carrying the acquisition id and per-entry time', () => {
    expect(statusViewToDto(view)).toEqual({
      importId: 'imp-1',
      acquisitionId: 'acq-1',
      path: DIRECTORY,
      status: 'rejected',
      location: undefined,
      review: undefined,
      rejection: { reason: 'r', filesDeleted: true },
      history: [{ kind: 'rejected', at: 't', reason: 'r', filesDeleted: true }],
    });
  });

  it('omits the acquisition id for a manually-submitted import', () => {
    expect(statusViewToDto({ ...view, acquisitionId: undefined }).acquisitionId).toBeUndefined();
  });

  it('maps a status view carrying an open review', () => {
    const withReview: ImportStatusView = {
      importId: toImportId('imp-2'),
      directory: DIRECTORY,
      phase: 'awaiting-review',
      openReview: { cause: { kind: 'no-match' }, candidates: [] },
      history: [],
    };
    expect(statusViewToDto(withReview).review).toEqual({ kind: 'no-match' });
  });

  it('maps a pending review item', () => {
    expect(
      pendingReviewToDto({
        importId: toImportId('imp-1'),
        directory: DIRECTORY,
        review: { cause: { kind: 'no-match' }, candidates: [] },
      }),
    ).toEqual({ importId: 'imp-1', path: DIRECTORY, review: { kind: 'no-match' } });
  });
});

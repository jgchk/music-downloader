import { describe, expect, it } from 'vitest';
import {
  DIRECTORY,
  FAILURE,
  INCUMBENT,
  candidate,
} from '../domain/import/__fixtures__/import-fixtures.js';
import type {
  ImportStatusView,
  PendingReviewView,
} from '../application/projections/read-models.js';
import { asDistance } from '../domain/shared/__fixtures__/distance.js';
import { toAcquisitionId } from '../domain/shared/acquisition-id.js';
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
      resolutionToDomain({ verb: 'reject-unusable-delivery', reasons: ['corrupt rip'] }),
    ).toEqual({ kind: 'reject-unusable-delivery', reasons: ['corrupt rip'] });
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
        availableActions: [],
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
        availableActions: [],
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
      availableActions: [],
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
      reviewToDto({
        cause: { kind: 'match-review', hinted: false, best },
        candidates: [],
        availableActions: [],
      }),
    ).toEqual({ kind: 'match-review', hinted: false, best, candidates: [] });
    expect(
      reviewToDto({ cause: { kind: 'no-match' }, candidates: [], availableActions: [] }),
    ).toEqual({
      kind: 'no-match',
    });
    expect(
      reviewToDto({
        cause: { kind: 'remediation-review', failures: [FAILURE] },
        candidates: [],
        availableActions: [],
      }),
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
    settled: true,
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
      settled: true,
      history: [{ kind: 'rejected', at: 't', reason: 'r', filesDeleted: true }],
    });
  });

  it('carries the decided settledness through to the wire in both directions', () => {
    expect(statusViewToDto(view).settled).toBe(true);
    expect(statusViewToDto({ ...view, phase: 'proposing', settled: false }).settled).toBe(false);
  });

  it('omits the acquisition id for a manually-submitted import', () => {
    expect(statusViewToDto({ ...view, acquisitionId: undefined }).acquisitionId).toBeUndefined();
  });

  it('projects every history kind onto the wire as its exact schema shape', () => {
    const history: ImportStatusView['history'] = [
      { kind: 'requested', at: 't1', hints: { artist: 'a', album: 'b' } },
      { kind: 'requested', at: 't2' },
      { kind: 'proposed', at: 't3', candidateCount: 2, pinnedId: 'mb-1' },
      {
        kind: 'auto-apply-selected',
        at: 't4',
        candidate: { dataSource: 'musicbrainz', albumId: 'alb-1' },
        distance: 0.01,
      },
      { kind: 'review-required', at: 't5', reviewKind: 'match-review' },
      { kind: 'review-resolved', at: 't6', resolution: 'apply-candidate' },
      { kind: 'applied', at: 't7', location: '/library/x' },
      { kind: 'remediation-required', at: 't8', failures: [FAILURE] },
      { kind: 'rejected', at: 't9', reason: 'r', filesDeleted: false },
      {
        kind: 'release-verdict-recorded',
        at: 't10',
        acquisitionId: toAcquisitionId('acq-9'),
        reasons: ['unusable'],
      },
    ];
    const dto = statusViewToDto({ ...view, history });
    expect(dto.history).toEqual([
      { kind: 'requested', at: 't1', hints: { artist: 'a', album: 'b' } },
      { kind: 'requested', at: 't2', hints: undefined },
      { kind: 'proposed', at: 't3', candidateCount: 2, pinnedId: 'mb-1' },
      {
        kind: 'auto-apply-selected',
        at: 't4',
        candidate: { dataSource: 'musicbrainz', albumId: 'alb-1' },
        distance: 0.01,
      },
      { kind: 'review-required', at: 't5', reviewKind: 'match-review' },
      { kind: 'review-resolved', at: 't6', resolution: 'apply-candidate' },
      { kind: 'applied', at: 't7', location: '/library/x' },
      { kind: 'remediation-required', at: 't8', failures: [FAILURE] },
      { kind: 'rejected', at: 't9', reason: 'r', filesDeleted: false },
      {
        kind: 'release-verdict-recorded',
        at: 't10',
        acquisitionId: 'acq-9',
        reasons: ['unusable'],
      },
    ]);
    // The wire copy is a fresh projection, never the projection's own objects.
    expect(dto.history[7]).not.toBe(history[7]);
  });

  it('cannot leak a domain-only history field onto the wire', () => {
    // Simulate a future projection-only field the wire schema does not know: an explicit per-kind
    // projection must drop it, where a spread would leak it into every consumer's payload.
    const entry = {
      kind: 'applied',
      at: 't',
      location: '/library/x',
      projectionOnlyDebugField: 'must-not-ship',
    } as unknown as ImportStatusView['history'][number];
    const dto = statusViewToDto({ ...view, history: [entry] });
    expect(dto.history[0]).toEqual({ kind: 'applied', at: 't', location: '/library/x' });
    expect(dto.history[0]).not.toHaveProperty('projectionOnlyDebugField');
  });

  it('cannot leak a domain-only field from a nested history payload onto the wire', () => {
    // The leaf level is pinned too: hints and failure elements are explicit field projections,
    // not spreads, so a future projection-only field inside them cannot ship either.
    const hintsEntry = {
      kind: 'requested',
      at: 't1',
      hints: { artist: 'a', album: 'b', projectionOnlyHintField: 'must-not-ship' },
    } as unknown as ImportStatusView['history'][number];
    const failuresEntry = {
      kind: 'remediation-required',
      at: 't2',
      failures: [{ ...FAILURE, projectionOnlyFailureField: 'must-not-ship' }],
    } as unknown as ImportStatusView['history'][number];

    const dto = statusViewToDto({ ...view, history: [hintsEntry, failuresEntry] });

    expect(dto.history[0]).toEqual({ kind: 'requested', at: 't1', hints: { artist: 'a', album: 'b' } });
    expect((dto.history[0] as { hints?: object }).hints).not.toHaveProperty(
      'projectionOnlyHintField',
    );
    expect(dto.history[1]).toEqual({ kind: 'remediation-required', at: 't2', failures: [FAILURE] });
    expect(
      (dto.history[1] as { failures: object[] }).failures[0],
    ).not.toHaveProperty('projectionOnlyFailureField');
  });

  it('maps a status view carrying an open review', () => {
    const withReview: ImportStatusView = {
      importId: toImportId('imp-2'),
      directory: DIRECTORY,
      phase: 'awaiting-review',
      settled: false,
      openReview: {
        cause: { kind: 'no-match' },
        candidates: [],
        availableActions: ['supply-id', 'reject'],
      },
      history: [],
    };
    const statusDto = statusViewToDto(withReview);
    expect(statusDto.review).toEqual({ kind: 'no-match' });
    // The status-view embed is informational: it does NOT carry the actionable verb set.
    expect(statusDto.review).not.toHaveProperty('availableActions');
  });

  it('maps a pending review item, carrying its permitted verb set', () => {
    expect(
      pendingReviewToDto({
        importId: toImportId('imp-1'),
        directory: DIRECTORY,
        review: {
          cause: { kind: 'no-match' },
          candidates: [],
          availableActions: ['supply-id', 'refresh-candidates', 'reject'],
        },
      }),
    ).toEqual({
      importId: 'imp-1',
      path: DIRECTORY,
      review: { kind: 'no-match' },
      availableActions: ['supply-id', 'refresh-candidates', 'reject'],
    });
  });

  it('projects each review kind’s permitted set onto the pending DTO', () => {
    const pending = (review: PendingReviewView['review']): readonly string[] | undefined =>
      pendingReviewToDto({ importId: toImportId('imp-1'), directory: DIRECTORY, review })
        .availableActions;
    expect(
      pending({ cause: { kind: 'no-match' }, candidates: [], availableActions: ['reject'] }),
    ).toEqual(['reject']);
    expect(
      pending({
        cause: { kind: 'remediation-review', failures: [FAILURE] },
        candidates: [],
        availableActions: ['accept', 'retry-enrichment'],
      }),
    ).toEqual(['accept', 'retry-enrichment']);
  });
});

import { describe, expect, it } from 'vitest';
import {
  APPLIED,
  AUTO_APPLIED,
  DELIVERED_CANDIDATE,
  DIRECTORY,
  FAILURE,
  HINTS,
  MATCH_REVIEW,
  SOURCE,
  appliedHistory,
  awaitingMatchReview,
  awaitingReviewWithCandidate,
  candidate,
  proposed,
  remediationHistory,
  requested,
  resolved,
} from '../../domain/import/__fixtures__/import-fixtures.js';
import { asDistance } from '../../domain/shared/__fixtures__/distance.js';
import type { ImportEvent } from '../../domain/import/events.js';
import type { StoredEvent } from '../ports/event-store-port.js';
import { ImportStatusProjection, projectStatus } from './read-models.js';

function storedAll(
  streamId: string,
  events: readonly ImportEvent[],
  from = 0,
  at: (index: number) => string = () => 't',
): StoredEvent[] {
  return events.map((event, index) => ({
    globalSeq: from + index + 1,
    streamId,
    version: index,
    type: event.type,
    event,
    metadata: { importId: streamId, occurredAt: at(index) },
  }));
}

describe('projectStatus', () => {
  it('narrates the full history of an applied import', () => {
    const history: ImportEvent[] = [
      requested({ hints: HINTS }),
      proposed([candidate()], [], 'mb-1'),
      AUTO_APPLIED,
      APPLIED,
    ];
    const view = projectStatus('imp-1', storedAll('imp-1', history));
    expect(view).toMatchObject({
      importId: 'imp-1',
      directory: DIRECTORY,
      phase: 'applied',
      location: '/library/Artist/Album',
    });
    expect(view.history).toEqual([
      { kind: 'requested', at: 't', hints: HINTS },
      { kind: 'proposed', at: 't', candidateCount: 1, pinnedId: 'mb-1' },
      {
        kind: 'auto-apply-selected',
        at: 't',
        candidate: candidate().ref,
        distance: asDistance(0.05),
      },
      { kind: 'applied', at: 't', location: '/library/Artist/Album' },
    ]);
  });

  it('stamps each history entry with its event occurrence time', () => {
    const view = projectStatus(
      'imp-1',
      storedAll('imp-1', appliedHistory(), 0, (index) => `2026-01-01T00:00:0${index}Z`),
    );
    expect(view.history.map((entry) => entry.at)).toEqual([
      '2026-01-01T00:00:00Z',
      '2026-01-01T00:00:01Z',
      '2026-01-01T00:00:02Z',
      '2026-01-01T00:00:03Z',
    ]);
  });

  it('carries the originating acquisition id when the import came from one', () => {
    const withSource = projectStatus(
      'imp-1',
      storedAll('imp-1', [requested({ source: SOURCE }), proposed([candidate()])]),
    );
    expect(withSource.acquisitionId).toBe('acq-1');

    const manual = projectStatus('imp-2', storedAll('imp-2', appliedHistory()));
    expect(manual.acquisitionId).toBeUndefined();
  });

  it('explains why review was required and what the human chose', () => {
    const history = [
      ...awaitingMatchReview(),
      resolved({ kind: 'reject', reason: 'wrong rip' }),
      { type: 'ImportRejected', reason: 'wrong rip', filesDeleted: true } as const,
    ];
    const view = projectStatus('imp-1', storedAll('imp-1', history));
    expect(view.history).toContainEqual({
      kind: 'review-required',
      at: 't',
      reviewKind: 'match-review',
    });
    expect(view.history).toContainEqual({ kind: 'review-resolved', at: 't', resolution: 'reject' });
    expect(view.history).toContainEqual({
      kind: 'rejected',
      at: 't',
      reason: 'wrong rip',
      filesDeleted: true,
    });
    expect(view.rejection).toEqual({ reason: 'wrong rip', filesDeleted: true });
  });

  it('records remediation entries', () => {
    const view = projectStatus('imp-1', storedAll('imp-1', remediationHistory()));
    expect(view.history).toContainEqual({
      kind: 'remediation-required',
      at: 't',
      failures: [FAILURE],
    });
  });

  it('narrates a recorded release verdict beside its rejection', () => {
    const history = [
      ...awaitingReviewWithCandidate(),
      resolved({ kind: 'reject-and-retry-download', reasons: ['corrupt rip'] }),
      {
        type: 'ReleaseVerdictRecorded',
        acquisitionId: SOURCE.acquisitionId,
        candidate: DELIVERED_CANDIDATE,
        reasons: ['corrupt rip'],
      } as const,
    ];
    const view = projectStatus('imp-1', storedAll('imp-1', history));
    expect(view.history).toContainEqual({
      kind: 'review-resolved',
      at: 't',
      resolution: 'reject-and-retry-download',
    });
    expect(view.history).toContainEqual({
      kind: 'release-verdict-recorded',
      at: 't',
      acquisitionId: 'acq-1',
      reasons: ['corrupt rip'],
    });
  });
});

describe('ImportStatusProjection', () => {
  it('indexes acquisition-sourced requests and forgets them on rebuild', () => {
    const projection = new ImportStatusProjection();
    projection.apply(storedAll('imp-a', [requested({ source: { acquisitionId: 'acq-1' } })])[0]!);
    projection.apply(storedAll('imp-b', [requested()], 10)[0]!);

    expect(projection.importIdForAcquisition('acq-1')).toBe('imp-a');
    expect(projection.importIdForAcquisition('acq-unknown')).toBeUndefined();

    projection.rebuild(storedAll('imp-b', [requested()]));
    expect(projection.importIdForAcquisition('acq-1')).toBeUndefined();
  });

  it('follows applied events and serves get/list', () => {
    const projection = new ImportStatusProjection();
    for (const stored of storedAll('imp-1', awaitingMatchReview())) projection.apply(stored);

    expect(projection.get('imp-1')?.phase).toBe('awaiting-review');
    expect(projection.get('imp-2')).toBeUndefined();
    expect(projection.list().map((view) => view.importId)).toEqual(['imp-1']);
  });

  it('lists pending reviews with their carried context, skipping settled imports', () => {
    const projection = new ImportStatusProjection();
    for (const stored of storedAll('imp-1', awaitingMatchReview())) projection.apply(stored);
    for (const stored of storedAll('imp-2', appliedHistory(), 10)) projection.apply(stored);

    const reviews = projection.pendingReviews();
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({
      importId: 'imp-1',
      directory: DIRECTORY,
      review: {
        cause: { kind: 'match-review' },
        candidates: [candidate({ distance: asDistance(0.5) })],
      },
    });
  });

  it('rebuilds from the log, replacing prior state', () => {
    const projection = new ImportStatusProjection();
    for (const stored of storedAll('imp-old', [requested()])) projection.apply(stored);

    projection.rebuild(storedAll('imp-1', appliedHistory()));

    expect(projection.get('imp-old')).toBeUndefined();
    expect(projection.get('imp-1')?.phase).toBe('applied');
  });

  it('never lists a review for a stream that only holds an unfitting event', () => {
    const projection = new ImportStatusProjection();
    // A corrupt stream: a review event with no request before it folds to empty (no directory).
    projection.apply(storedAll('imp-x', [MATCH_REVIEW])[0]!);
    expect(projection.pendingReviews()).toEqual([]);
  });
});

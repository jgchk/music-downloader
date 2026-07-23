import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import type { PendingReviewDto } from '@music/importer';
import ReviewDetail from './ReviewDetail.svelte';

const candidate = {
  ref: { dataSource: 'MusicBrainz', albumId: 'r-1' },
  artist: 'A',
  album: 'L',
  distance: 0.2,
  penalties: [],
  tracks: [],
};

// Typed so a wire-contract rename fails these at compile time; the one intentionally-unknown kind
// passes its own `as never` at the call site (the tolerant-reader forward-compat test). Action
// affordances follow the decided `availableActions`, so each test supplies the permitted verb set.
function pending(
  review: PendingReviewDto['review'],
  availableActions?: PendingReviewDto['availableActions'],
): PendingReviewDto {
  return { importId: 'imp-1', path: '/intake/x', review, availableActions };
}

const MATCH_ACTIONS: NonNullable<PendingReviewDto['availableActions']> = [
  'apply-candidate',
  'supply-id',
  'refresh-candidates',
  'manual-tags',
  'import-as-is',
  'reject',
  'reject-unusable-delivery',
];

describe('ReviewDetail (SSR)', () => {
  it('renders a hinted match review with candidates and the full verb set', () => {
    const { body } = render(ReviewDetail, {
      props: {
        pending: pending(
          { kind: 'match-review', hinted: true, candidates: [candidate] },
          MATCH_ACTIONS,
        ),
        error: 'This review has already been settled.',
      },
    });
    // The heading is the intake path, and the chip glosses the kind in plain language.
    expect(body).toContain('<h1>/intake/x</h1>');
    expect(body).toContain('Match review');
    // The context line is the composed summary, not an empty span.
    expect(body).toContain('1 candidate — best 20.0% away (a release was hinted)');
    expect(body).toContain('data-testid="hinted"');
    expect(body).toContain('data-testid="candidates"');
    expect(body).toContain('data-testid="supply-id"');
    expect(body).toContain('data-testid="reject-unusable"');
    expect(body).toContain('data-testid="manual-tags"');
    expect(body).toContain('data-testid="action-error"');
  });

  it('renders an unhinted match review without the hint note or error banner', () => {
    const { body } = render(ReviewDetail, {
      props: {
        pending: pending({ kind: 'match-review', hinted: false, candidates: [] }, MATCH_ACTIONS),
      },
    });
    expect(body).not.toContain('data-testid="hinted"');
    expect(body).not.toContain('data-testid="action-error"');
  });

  it('words a contradicted hint honestly when the best candidate is a different release', () => {
    const { body } = render(ReviewDetail, {
      props: {
        pending: pending(
          {
            kind: 'match-review',
            hinted: true,
            hintedReleaseId: 'other',
            best: candidate.ref,
            candidates: [candidate],
          },
          MATCH_ACTIONS,
        ),
      },
    });
    expect(body).toContain('data-testid="hinted"');
    expect(body).toContain('was not the best match');
  });

  it('does not call a weak match on the pinned release a contradiction', () => {
    const { body } = render(ReviewDetail, {
      props: {
        pending: pending(
          {
            kind: 'match-review',
            hinted: true,
            hintedReleaseId: candidate.ref.albumId,
            best: candidate.ref,
            candidates: [candidate],
          },
          MATCH_ACTIONS,
        ),
      },
    });
    expect(body).toContain('matched your pinned release');
  });

  it('renders no-match as an absence, with manual and pinned paths out', () => {
    const { body } = render(ReviewDetail, {
      props: {
        pending: pending({ kind: 'no-match' }, [
          'supply-id',
          'refresh-candidates',
          'manual-tags',
          'import-as-is',
          'reject',
        ]),
      },
    });
    expect(body).toContain('data-testid="no-match-note"');
    expect(body).toContain('data-testid="manual-tags"');
    expect(body).toContain('data-testid="import-as-is"');
  });

  it('renders a duplicate review with incumbents and the duplicate action', () => {
    const { body } = render(ReviewDetail, {
      props: {
        pending: pending(
          {
            kind: 'duplicate-review',
            incumbents: [{ artist: 'A', album: 'L', path: '/lib/al' }],
            candidates: [candidate],
          },
          ['apply-candidate', 'reject', 'reject-unusable-delivery'],
        ),
      },
    });
    expect(body).toContain('data-testid="incumbents"');
    // The incumbent row reads artist — album (path), the operator's disambiguation.
    expect(body).toContain('A — L (/lib/al)');
    expect(body).toContain('data-testid="duplicate-action"');
    expect(body).not.toContain('data-testid="manual-tags"');
  });

  it('renders an unknown review kind through a generic fallback instead of assuming remediation', () => {
    const { body } = render(ReviewDetail, {
      props: { pending: pending({ kind: 'quarantine-review' } as never) },
    });
    expect(body).toContain('data-testid="unknown-review"');
    expect(body).not.toContain('data-testid="failures"');
  });

  it('renders a remediation review with failures and accept/retry only', () => {
    const { body } = render(ReviewDetail, {
      props: {
        pending: pending(
          {
            kind: 'remediation-review',
            failures: [{ stage: 'fetchart', message: 'network down' }],
          },
          ['accept', 'retry-enrichment'],
        ),
      },
    });
    expect(body).toContain('data-testid="failures"');
    expect(body).toContain('fetchart: network down');
    expect(body).toContain('data-testid="accept"');
    expect(body).toContain('data-testid="retry-enrichment"');
    expect(body).not.toContain('data-testid="reject"');
  });

  it('renders exactly the permitted verbs — a match review lacking the retry omits its form', () => {
    // Same match review, but the importer withheld reject-unusable-delivery (no retained candidate).
    const { body } = render(ReviewDetail, {
      props: {
        pending: pending({ kind: 'match-review', hinted: false, candidates: [candidate] }, [
          'apply-candidate',
          'supply-id',
          'refresh-candidates',
          'manual-tags',
          'import-as-is',
          'reject',
        ]),
      },
    });
    expect(body).toContain('data-testid="supply-id"');
    expect(body).toContain('data-testid="reject"');
    expect(body).toContain('data-testid="apply"');
    // The retry verb is not permitted, so its form is absent — but plain reject stays.
    expect(body).not.toContain('data-testid="reject-unusable"');
  });

  it('degrades safely when the permitted-action set is absent — no action forms, no crash', () => {
    const { body } = render(ReviewDetail, {
      props: { pending: pending({ kind: 'match-review', hinted: false, candidates: [candidate] }) },
    });
    // The evidence still renders (the candidate table), but no action affordances are offered.
    expect(body).toContain('data-testid="candidates"');
    expect(body).not.toContain('data-testid="apply"');
    expect(body).not.toContain('data-testid="supply-id"');
    expect(body).not.toContain('data-testid="reject"');
    expect(body).not.toContain('data-testid="manual-tags"');
  });
});

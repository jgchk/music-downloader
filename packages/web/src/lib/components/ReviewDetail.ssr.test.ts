import type { ComponentProps } from 'svelte';
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

function renderProperties(
  review: PendingReviewDto['review'],
  availableActions?: PendingReviewDto['availableActions'],
  over?: Partial<ComponentProps<typeof ReviewDetail>>,
): ComponentProps<typeof ReviewDetail> {
  return { pending: pending(review, availableActions), title: 'Artist — Album', ...over };
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
  it('titles by the musical intent with the staged path as labeled supporting detail', () => {
    const { body } = render(ReviewDetail, {
      props: renderProperties(
        { kind: 'match-review', hinted: true, candidates: [candidate] },
        MATCH_ACTIONS,
      ),
    });
    expect(body).toContain('<h1>Artist — Album</h1>');
    expect(body).toContain('data-testid="staged-path"');
    expect(body).toContain('/intake/x');
    // The chip speaks the ask; the context line is the composed summary.
    expect(body).toContain('Choose a match');
    expect(body).toContain('1 candidate match — best: Weak match (80%) — a release was hinted');
    expect(body).toContain('data-testid="hinted"');
    expect(body).toContain('data-testid="candidates"');
    expect(body).toContain('data-testid="supply-id"');
    expect(body).toContain('data-testid="reject-unusable"');
    expect(body).toContain('data-testid="manual-tags"');
  });

  it('surfaces an action failure banner when an error is supplied', () => {
    const { body } = render(ReviewDetail, {
      props: renderProperties(
        { kind: 'match-review', hinted: true, candidates: [candidate] },
        MATCH_ACTIONS,
        { error: 'This review has already been settled.' },
      ),
    });
    expect(body).toContain('data-testid="action-error"');
    expect(body).toContain('This review has already been settled.');
  });

  it('renders an unhinted match review without the hint note or error banner', () => {
    const { body } = render(ReviewDetail, {
      props: renderProperties(
        { kind: 'match-review', hinted: false, candidates: [] },
        MATCH_ACTIONS,
      ),
    });
    expect(body).not.toContain('data-testid="hinted"');
    expect(body).not.toContain('data-testid="action-error"');
  });

  it('words a contradicted hint honestly when the best candidate is a different release', () => {
    const { body } = render(ReviewDetail, {
      props: renderProperties(
        {
          kind: 'match-review',
          hinted: true,
          hintedReleaseId: 'other',
          best: candidate.ref,
          candidates: [candidate],
        },
        MATCH_ACTIONS,
      ),
    });
    expect(body).toContain('data-testid="hinted"');
    expect(body).toContain('was not the best match');
  });

  it('does not call a weak match on the pinned release a contradiction', () => {
    const { body } = render(ReviewDetail, {
      props: renderProperties(
        {
          kind: 'match-review',
          hinted: true,
          hintedReleaseId: candidate.ref.albumId,
          best: candidate.ref,
          candidates: [candidate],
        },
        MATCH_ACTIONS,
      ),
    });
    expect(body).toContain('matched your pinned release');
  });

  it('renders no-match source-agnostically, never naming the matcher', () => {
    const { body } = render(ReviewDetail, {
      props: renderProperties({ kind: 'no-match' }, [
        'supply-id',
        'refresh-candidates',
        'manual-tags',
        'import-as-is',
        'reject',
      ]),
    });
    expect(body).toContain('data-testid="no-match-note"');
    expect(body).toContain('No release matched these files in any connected source');
    expect(body).not.toContain('Beets');
    expect(body).not.toContain('beets');
    expect(body).toContain('data-testid="manual-tags"');
    expect(body).toContain('data-testid="import-as-is"');
  });

  it('renders a duplicate review with incumbents and the duplicate action', () => {
    const { body } = render(ReviewDetail, {
      props: renderProperties(
        {
          kind: 'duplicate-review',
          incumbents: [{ artist: 'A', album: 'L', path: '/lib/al' }],
          candidates: [candidate],
        },
        ['apply-candidate', 'reject', 'reject-unusable-delivery'],
      ),
    });
    expect(body).toContain('data-testid="incumbents"');
    // The incumbent row reads artist — album (path), the operator's disambiguation.
    expect(body).toContain('A — L (/lib/al)');
    expect(body).toContain('data-testid="duplicate-action"');
    expect(body).not.toContain('data-testid="manual-tags"');
  });

  it('renders an unknown review kind through a generic fallback with the raw kind in disclosure', () => {
    const { body } = render(ReviewDetail, {
      props: renderProperties({ kind: 'quarantine-review' } as never),
    });
    expect(body).toContain('data-testid="unknown-review"');
    expect(body).toContain('This needs your attention, but this page can’t describe it yet');
    expect(body).toContain('quarantine-review');
    // The chip and context line degrade to their neutral phrases, never empty text.
    expect(body).toContain('Needs your attention');
    expect(body).toContain('Awaiting your decision');
    expect(body).not.toContain('data-testid="failures"');
  });

  it('renders a remediation review with glossed failures and accept/retry only', () => {
    const { body } = render(ReviewDetail, {
      props: renderProperties(
        {
          kind: 'remediation-review',
          failures: [{ stage: 'fetchart', message: 'network down' }],
        },
        ['accept', 'retry-enrichment'],
      ),
    });
    expect(body).toContain('Added to the library, but some finishing steps failed');
    expect(body).toContain('data-testid="failures"');
    expect(body).toContain('fetching album art: network down');
    expect(body).toContain('data-testid="accept"');
    expect(body).toContain('data-testid="retry-enrichment"');
    expect(body).not.toContain('data-testid="reject"');
  });

  it('renders exactly the permitted verbs — a match review lacking the retry omits its form', () => {
    // Same match review, but the importer withheld reject-unusable-delivery (no retained candidate).
    const { body } = render(ReviewDetail, {
      props: renderProperties({ kind: 'match-review', hinted: false, candidates: [candidate] }, [
        'apply-candidate',
        'supply-id',
        'refresh-candidates',
        'manual-tags',
        'import-as-is',
        'reject',
      ]),
    });
    expect(body).toContain('data-testid="supply-id"');
    expect(body).toContain('data-testid="reject"');
    expect(body).toContain('data-testid="apply"');
    // The retry verb is not permitted, so its form is absent — but plain reject stays.
    expect(body).not.toContain('data-testid="reject-unusable"');
  });

  it('degrades safely when the permitted-action set is absent — no action forms, an honest note', () => {
    const { body } = render(ReviewDetail, {
      props: renderProperties({ kind: 'match-review', hinted: false, candidates: [candidate] }),
    });
    // The evidence still renders (the candidate table), but no action affordances are offered —
    // and the absence is stated rather than left as a silent dead end.
    expect(body).toContain('data-testid="candidates"');
    expect(body).not.toContain('data-testid="apply"');
    expect(body).not.toContain('data-testid="supply-id"');
    expect(body).not.toContain('data-testid="reject"');
    expect(body).not.toContain('data-testid="manual-tags"');
    expect(body).toContain('data-testid="no-actions"');
    expect(body).toContain('No actions are available for this review yet');
  });

  it('replaces the action forms with the confirm step while a destructive resolution pends', () => {
    const { body } = render(ReviewDetail, {
      props: renderProperties(
        { kind: 'match-review', hinted: false, candidates: [candidate] },
        MATCH_ACTIONS,
        {
          confirm: { verb: 'reject', reason: 'bad rip' },
        },
      ),
    });
    expect(body).toContain('data-testid="confirm-destructive"');
    // The confirm step leads the document — after a native POST reload it must be the first
    // thing read, not buried below the evidence — and is reachable in the heading order.
    expect(body.indexOf('data-testid="confirm-destructive"')).toBeLessThan(
      body.indexOf('data-testid="candidates"'),
    );
    expect(body).toContain('<h2>Delete the downloaded files?</h2>');
    // The specific consequence, restated with the composed contract from the verb inventory.
    expect(body).toContain('This deletes the downloaded files.');
    expect(body).toContain('Nothing more will be tried');
    // Exactly two outcome-named choices — never a bare yes/no — and declining returns to THIS
    // review, not the queue.
    expect(body).toContain('data-testid="confirm-delete"');
    expect(body).toContain('Delete the files');
    expect(body).toContain('data-testid="confirm-keep"');
    expect(body).toContain('Keep the files');
    expect(body).toContain('href="/reviews/imp-1"');
    // The committing form re-posts the verb with its payload and the confirmed marker.
    expect(body).toContain('value="reject"');
    expect(body).toContain('value="bad rip"');
    expect(body).toContain('name="confirmed"');
    // The ordinary action forms yield to the confirm step — including the per-candidate apply.
    expect(body).not.toContain('data-testid="supply-id"');
    expect(body).not.toContain('data-testid="manual-tags"');
    expect(body).not.toContain('data-testid="apply"');
  });

  it('states the revival consequence when confirming an unusable-delivery rejection', () => {
    const { body } = render(ReviewDetail, {
      props: renderProperties(
        { kind: 'match-review', hinted: false, candidates: [candidate] },
        MATCH_ACTIONS,
        {
          confirm: { verb: 'reject-unusable-delivery', reasons: 'truncated\nclipped' },
        },
      ),
    });
    expect(body).toContain('data-testid="confirm-destructive"');
    expect(body).toContain('The search for a replacement continues.');
    expect(body).toContain('value="reject-unusable-delivery"');
    // Multi-line reasons survive the hidden-field echo intact — both lines, not just the first.
    expect(body).toContain('truncated');
    expect(body).toContain('clipped');
  });
});

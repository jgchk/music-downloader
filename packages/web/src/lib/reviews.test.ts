import { describe, expect, it } from 'vitest';
import type { PendingReviewDto } from '@music/importer';
import { contextSummary, formatDistance, kindLabel } from './reviews.js';

const candidate = {
  ref: { dataSource: 'MusicBrainz', albumId: 'r-1' },
  artist: 'A',
  album: 'L',
  distance: 0.123,
  penalties: [],
  tracks: [],
};

function pending(review: PendingReviewDto['review']): PendingReviewDto {
  return { importId: 'imp-1', path: '/intake/x', review };
}

describe('kindLabel', () => {
  it.each([
    ['match-review', 'Match review'],
    ['no-match', 'No match'],
    ['duplicate-review', 'Duplicate'],
    ['remediation-review', 'Remediation'],
  ] as const)('%s -> %s', (kind, label) => {
    expect(kindLabel(kind)).toBe(label);
  });
});

describe('contextSummary', () => {
  it('summarizes a match review with candidate count and best distance', () => {
    expect(
      contextSummary(pending({ kind: 'match-review', hinted: false, candidates: [candidate] })),
    ).toBe('1 candidate — best 12.3% away');
  });

  it('marks a hint contradiction and pluralizes', () => {
    expect(
      contextSummary(
        pending({ kind: 'match-review', hinted: true, candidates: [candidate, candidate] }),
      ),
    ).toBe('2 candidates — best 12.3% away (hint contradicted)');
  });

  it('handles a match review with no candidates', () => {
    expect(contextSummary(pending({ kind: 'match-review', hinted: false, candidates: [] }))).toBe(
      '0 candidates',
    );
  });

  it('states no-match as an absence of candidates, not low confidence', () => {
    expect(contextSummary(pending({ kind: 'no-match' }))).toBe('Beets found no candidates at all');
  });

  it('names the duplicate incumbent', () => {
    expect(
      contextSummary(
        pending({
          kind: 'duplicate-review',
          incumbents: [{ artist: 'A', album: 'L', path: '/lib/a' }],
          candidates: [candidate],
        }),
      ),
    ).toBe('Already in the library: A — L');
  });

  it('falls back when the duplicate has no incumbent detail', () => {
    expect(
      contextSummary(pending({ kind: 'duplicate-review', incumbents: [], candidates: [] })),
    ).toBe('Already in the library: library');
  });

  it('names the failed remediation stage', () => {
    expect(
      contextSummary(
        pending({
          kind: 'remediation-review',
          failures: [{ stage: 'fetchart', message: 'network' }],
        }),
      ),
    ).toBe('Import applied, but fetchart failed');
  });

  it('falls back when remediation carries no failures', () => {
    expect(contextSummary(pending({ kind: 'remediation-review', failures: [] }))).toBe(
      'A post-import step failed',
    );
  });
});

describe('formatDistance', () => {
  it('renders a 0..1 distance as a percentage', () => {
    expect(formatDistance(0.05)).toBe('5.0%');
  });
});

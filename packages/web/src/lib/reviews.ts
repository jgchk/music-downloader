import type { PendingReviewDto, ReviewDto } from '@music/importer';

/**
 * Presentation vocabulary for the review queue: pure mappings from importer facade DTOs to what
 * the queue shows. No-match is deliberately distinct from low confidence (match-review spec).
 */

export function kindLabel(kind: ReviewDto['kind']): string {
  switch (kind) {
    case 'match-review':
      return 'Match review';
    case 'no-match':
      return 'No match';
    case 'duplicate-review':
      return 'Duplicate';
    case 'remediation-review':
      return 'Remediation';
  }
}

export function contextSummary(pending: PendingReviewDto): string {
  const review = pending.review;
  switch (review.kind) {
    case 'match-review': {
      const best = review.candidates[0];
      const detail = best === undefined ? '' : ` — best ${formatDistance(best.distance)} away`;
      return `${review.candidates.length} candidate${review.candidates.length === 1 ? '' : 's'}${detail}${review.hinted ? ' (hint contradicted)' : ''}`;
    }
    case 'no-match':
      return 'Beets found no candidates at all';
    case 'duplicate-review': {
      const incumbent = review.incumbents[0];
      const who = incumbent === undefined ? 'library' : `${incumbent.artist} — ${incumbent.album}`;
      return `Already in the library: ${who}`;
    }
    case 'remediation-review': {
      const failure = review.failures[0];
      return failure === undefined
        ? 'A post-import step failed'
        : `Import applied, but ${failure.stage} failed`;
    }
  }
}

/** Distances are 0..1 where smaller is better; show as a percentage penalty. */
export function formatDistance(distance: number): string {
  return `${(distance * 100).toFixed(1)}%`;
}

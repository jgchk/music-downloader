import type { PendingReviewDto, ReviewDto } from '@music/importer';

/**
 * Presentation vocabulary for the review queue: pure mappings from importer facade DTOs to what
 * the queue shows. No-match is deliberately distinct from low confidence (match-review spec).
 */

export function kindLabel(kind: ReviewDto['kind']): string {
  switch (kind) {
    case 'match-review': {
      return 'Match review';
    }
    case 'no-match': {
      return 'No match';
    }
    case 'duplicate-review': {
      return 'Duplicate';
    }
    case 'remediation-review': {
      return 'Remediation';
    }
  }
}

type MatchReview = Extract<ReviewDto, { kind: 'match-review' }>;

/**
 * The honest hint outcome. `hinted` alone only means an id was in play; "contradicted" is true only
 * when the best candidate's release differs from the pinned one. A weak match on the *same* release
 * is confirmed-but-uncertain, not contradicted — and a legacy review carrying no pinned id can only
 * say a hint was present. Returns undefined when no hint applies.
 */
export function hintNote(review: MatchReview): string | undefined {
  if (!review.hinted) return undefined;
  const pinned = review.hintedReleaseId;
  const best = review.best;
  if (pinned === undefined || best === undefined) return 'a release was hinted';
  return best.albumId === pinned
    ? 'matched your pinned release, but low confidence'
    : 'the release you pinned was not the best match';
}

/** Plain-language label for beets' penalty keys, so the demoted score line is not bare jargon. */
export function penaltyLabel(name: string): string {
  const glossary: Record<string, string> = {
    album_id: 'different release',
    album: 'album title',
    artist: 'artist',
    tracks: 'track differences',
    unmatched_tracks: 'extra files',
    missing_tracks: 'missing tracks',
    data_source: 'metadata source',
    source: 'metadata source',
    media: 'disc format',
    mediums: 'disc count',
    year: 'year',
    country: 'country',
    label: 'label',
    catalognum: 'catalog number',
    albumdisambig: 'release disambiguation',
  };
  return glossary[name] ?? name;
}

/** Whether a mapped track would be retagged: its current title differs from the proposed one. */
export function isRetag(track: MatchReview['candidates'][number]['tracks'][number]): boolean {
  return track.current !== undefined && track.current.title !== track.title;
}

type CandidateAlbumFields = NonNullable<MatchReview['candidates'][number]['albumFields']>;

/** The candidate's non-empty album-level fields as labelled rows — the release-details panel. */
export function albumFieldList(fields: CandidateAlbumFields): { label: string; value: string }[] {
  const entries: readonly (readonly [string, string | number])[] = [
    ['Year', fields.year],
    ['Media', fields.media],
    ['Label', fields.label],
    ['Catalog #', fields.catalognum],
    ['Country', fields.country],
    ['Disambiguation', fields.albumDisambig],
  ];
  // Drop empties and beets' `[none]` placeholder so the panel never shows an absence as data.
  return entries
    .filter(([, value]) => value !== '' && value !== 0 && value !== '[none]')
    .map(([label, value]) => ({ label, value: String(value) }));
}

export function contextSummary(pending: PendingReviewDto): string {
  const review = pending.review;
  switch (review.kind) {
    case 'match-review': {
      const best = review.candidates[0];
      const detail = best === undefined ? '' : ` — best ${formatDistance(best.distance)} away`;
      const note = hintNote(review);
      const hint = note === undefined ? '' : ` (${note})`;
      return `${review.candidates.length} candidate${review.candidates.length === 1 ? '' : 's'}${detail}${hint}`;
    }
    case 'no-match': {
      return 'Beets found no candidates at all';
    }
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

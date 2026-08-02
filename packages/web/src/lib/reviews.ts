import type { PendingReviewDto, ReviewDto } from '@music/importer';
import { matchPercent } from './copy.js';

/**
 * Presentation vocabulary for the review surface: pure mappings from importer facade DTOs to what
 * the queue and detail pages show, written to the register (design D4/D6/D9): chips speak the ask,
 * match quality is coarse and higher-is-better, copy is source-agnostic — no internal tool names —
 * and every open-string code passes through a gloss map with a verbatim-safe fallback. No-match is
 * deliberately distinct from low confidence (match-review spec).
 */

/**
 * The chip names the decision waiting on the user — the ask, never the machinery
 * (reviews-register-alignment D8). Exhaustive over the compiled union (a new kind is a compile
 * error demanding its ask) with a tolerant runtime degrade for drifted data, mirroring the
 * detail page's unknown-kind arm — never an empty chip.
 */
export function kindLabel(kind: ReviewDto['kind']): string {
  switch (kind) {
    case 'match-review': {
      return 'Choose a match';
    }
    case 'no-match': {
      return 'No match found';
    }
    case 'duplicate-review': {
      return 'Already in the library';
    }
    case 'remediation-review': {
      return 'Fix after import';
    }
    default: {
      kind satisfies never;
      return 'Needs your attention';
    }
  }
}

// --- Match quality (design D6) -----------------------------------------------------------------

export interface MatchQuality {
  readonly category: 'Strong match' | 'Good match' | 'Weak match';
  readonly pct: number;
}

/**
 * Coarse, higher-is-better match quality: a category word plus the shipped whole-number percent —
 * never a raw distance or a lower-is-better figure in visible text (research §3). The bands are
 * presentation-only and live here so adjusting them is a copy change, no contract touch.
 */
export function matchQuality(distance: number): MatchQuality {
  const pct = matchPercent(distance);
  const category = pct >= 95 ? 'Strong match' : pct >= 85 ? 'Good match' : 'Weak match';
  return { category, pct };
}

/** The headline form: `Strong match — 96%`. */
export function matchQualityText(distance: number): string {
  const quality = matchQuality(distance);
  return `${quality.category} \u{2014} ${quality.pct}%`;
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

/** Plain-language label for the matcher's penalty keys, so the score line is not bare jargon. */
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

/**
 * Plain-language gloss for a remediation stage code. The stage is an open string on the wire, so
 * the fallback renders the code verbatim — visible but honest — rather than inventing a phrase.
 */
export function stageGloss(stage: string): string {
  const glossary: Record<string, string> = {
    embedart: 'embedding album art',
    fetchart: 'fetching album art',
    lyrics: 'fetching lyrics',
    scrub: 'cleaning old tags',
    replaygain: 'volume analysis',
  };
  return glossary[stage] ?? stage;
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
  // Drop empties and the matcher's `[none]` placeholder so the panel never shows an absence as data.
  return entries
    .filter(([, value]) => value !== '' && value !== 0 && value !== '[none]')
    .map(([label, value]) => ({ label, value: String(value) }));
}

export function contextSummary(pending: PendingReviewDto): string {
  const review = pending.review;
  switch (review.kind) {
    case 'match-review': {
      const best = review.candidates[0];
      // The percent qualifies its own category word in a compact metadata line, so it sits in
      // parentheses (the affordance register's aside ban is about consequence copy on actions).
      const detail =
        best === undefined
          ? ''
          : ` \u{2014} best: ${matchQuality(best.distance).category} (${matchQuality(best.distance).pct}%)`;
      const note = hintNote(review);
      const hint = note === undefined ? '' : ` \u{2014} ${note}`;
      const plural = review.candidates.length === 1 ? '' : 'es';
      return `${review.candidates.length} candidate match${plural}${detail}${hint}`;
    }
    case 'no-match': {
      return 'No release matched in any connected source';
    }
    case 'duplicate-review': {
      const incumbent = review.incumbents[0];
      const who = incumbent === undefined ? 'library' : `${incumbent.artist} — ${incumbent.album}`;
      return `Already in the library: ${who}`;
    }
    case 'remediation-review': {
      const failure = review.failures[0];
      return failure === undefined
        ? 'Added to the library, but a finishing step failed'
        : `Added to the library, but ${stageGloss(failure.stage)} failed`;
    }
    default: {
      review satisfies never;
      return 'Awaiting your decision';
    }
  }
}

/** Distances are 0..1 where smaller is better; the disclosure-only percentage form (design D7). */
export function formatDistance(distance: number): string {
  return `${(distance * 100).toFixed(1)}%`;
}

// --- Titling (design D3) -----------------------------------------------------------------------

/** Strip everything up to the last slash (a leaf path stays whole). */
export function pathBasename(path: string): string {
  return path.replace(/^.*\//u, '');
}

/**
 * The review's display title, falling through the musical intent — the acquisition's request
 * phrase, composed server-side — to the staged directory's basename, to a neutral awaiting-review
 * phrase. The staged path itself is supporting detail, never the title (research §2).
 */
export function reviewTitle(path: string, acquisitionTitle: string | undefined): string {
  if (acquisitionTitle !== undefined && acquisitionTitle !== '') return acquisitionTitle;
  const base = pathBasename(path);
  return base === '' ? 'Import awaiting review' : base;
}

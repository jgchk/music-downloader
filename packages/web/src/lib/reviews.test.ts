import { describe, expect, it } from 'vitest';
import type { PendingReviewDto } from '@music/importer';
import {
  albumFieldList,
  contextSummary,
  formatDistance,
  hintNote,
  isRetag,
  kindLabel,
  matchQuality,
  matchQualityText,
  pathBasename,
  penaltyLabel,
  reviewTitle,
  stageGloss,
} from './reviews.js';

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
    ['match-review', 'Choose a match'],
    ['no-match', 'No match found'],
    ['duplicate-review', 'Already in the library'],
    ['remediation-review', 'Fix after import'],
  ] as const)('speaks the ask, never the machinery: %s -> %s', (kind, label) => {
    expect(kindLabel(kind)).toBe(label);
  });
});

describe('matchQuality', () => {
  it('renders higher-is-better coarse categories with the shipped percent formula', () => {
    expect(matchQuality(0.04)).toEqual({ category: 'Strong match', pct: 96 });
    expect(matchQuality(0.123)).toEqual({ category: 'Good match', pct: 88 });
    expect(matchQuality(0.2)).toEqual({ category: 'Weak match', pct: 80 });
  });

  it('places the band boundaries at 95 and 85', () => {
    expect(matchQuality(0.05).category).toBe('Strong match');
    expect(matchQuality(0.15).category).toBe('Good match');
    expect(matchQuality(0.16).category).toBe('Weak match');
  });

  it('formats the headline as category — percent', () => {
    expect(matchQualityText(0.04)).toBe('Strong match — 96%');
  });
});

describe('stageGloss', () => {
  it('glosses known remediation stages and passes unknown ones through verbatim', () => {
    expect(stageGloss('fetchart')).toBe('fetching album art');
    expect(stageGloss('embedart')).toBe('embedding album art');
    expect(stageGloss('lyrics')).toBe('fetching lyrics');
    expect(stageGloss('some_future_stage')).toBe('some_future_stage');
  });
});

describe('contextSummary', () => {
  it('summarizes a match review with candidate count and coarse best quality', () => {
    expect(
      contextSummary(pending({ kind: 'match-review', hinted: false, candidates: [candidate] })),
    ).toBe('1 candidate match — best: Good match — 88%');
  });

  it('names a contradicted hint honestly when the best candidate is a different release', () => {
    expect(
      contextSummary(
        pending({
          kind: 'match-review',
          hinted: true,
          hintedReleaseId: 'other-release',
          best: candidate.ref,
          candidates: [candidate, candidate],
        }),
      ),
    ).toBe(
      '2 candidate matches — best: Good match — 88% — the release you pinned was not the best match',
    );
  });

  it('does not call a weak match on the pinned release a contradiction', () => {
    expect(
      contextSummary(
        pending({
          kind: 'match-review',
          hinted: true,
          hintedReleaseId: candidate.ref.albumId,
          best: candidate.ref,
          candidates: [candidate],
        }),
      ),
    ).toBe(
      '1 candidate match — best: Good match — 88% — matched your pinned release, but low confidence',
    );
  });

  it('falls back to a neutral note for a legacy hinted review with no pinned id', () => {
    expect(
      contextSummary(pending({ kind: 'match-review', hinted: true, candidates: [candidate] })),
    ).toBe('1 candidate match — best: Good match — 88% — a release was hinted');
  });

  it('handles a match review with no candidates', () => {
    expect(contextSummary(pending({ kind: 'match-review', hinted: false, candidates: [] }))).toBe(
      '0 candidate matches',
    );
  });

  it('states no-match source-agnostically, never naming the matcher', () => {
    expect(contextSummary(pending({ kind: 'no-match' }))).toBe(
      'No release matched in any connected source',
    );
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

  it('glosses the failed remediation stage', () => {
    expect(
      contextSummary(
        pending({
          kind: 'remediation-review',
          failures: [{ stage: 'fetchart', message: 'network' }],
        }),
      ),
    ).toBe('Added to the library, but fetching album art failed');
  });

  it('falls back when remediation carries no failures', () => {
    expect(contextSummary(pending({ kind: 'remediation-review', failures: [] }))).toBe(
      'Added to the library, but a finishing step failed',
    );
  });
});

describe('formatDistance', () => {
  it('renders a 0..1 distance as the disclosure-only percentage form', () => {
    expect(formatDistance(0.05)).toBe('5.0%');
  });
});

describe('reviewTitle', () => {
  it('prefers the composed acquisition title — the musical intent', () => {
    expect(reviewTitle('/intake/Artist - Album [FLAC]', 'Artist — Album')).toBe('Artist — Album');
  });

  it('falls back to the staged directory basename without a composed title', () => {
    expect(reviewTitle('/intake/Artist - Album [FLAC]', undefined)).toBe('Artist - Album [FLAC]');
  });

  it('treats an empty composed title as absent', () => {
    expect(reviewTitle('/intake/x', '')).toBe('x');
  });

  it('degrades to the neutral awaiting-review phrase when no path is available', () => {
    expect(reviewTitle('', undefined)).toBe('Import awaiting review');
  });
});

describe('pathBasename', () => {
  it('strips everything up to the last slash and keeps a leaf path whole', () => {
    expect(pathBasename('/intake/deep/leaf')).toBe('leaf');
    expect(pathBasename('leaf')).toBe('leaf');
  });
});

describe('hintNote', () => {
  it('returns undefined when no hint was in play', () => {
    expect(hintNote({ kind: 'match-review', hinted: false, candidates: [] })).toBeUndefined();
  });

  it('falls back to the neutral note when a pinned id is known but the best candidate is absent', () => {
    expect(
      hintNote({
        kind: 'match-review',
        hinted: true,
        hintedReleaseId: 'r-1',
        best: undefined,
        candidates: [],
      }),
    ).toBe('a release was hinted');
  });

  it('names a contradiction when the best candidate is a different release than the pinned one', () => {
    expect(
      hintNote({
        kind: 'match-review',
        hinted: true,
        hintedReleaseId: 'other-release',
        best: { dataSource: 'MusicBrainz', albumId: 'r-1' },
        candidates: [],
      }),
    ).toBe('the release you pinned was not the best match');
  });

  it('confirms-but-uncertain when the best candidate is the pinned release itself', () => {
    expect(
      hintNote({
        kind: 'match-review',
        hinted: true,
        hintedReleaseId: 'r-1',
        best: { dataSource: 'MusicBrainz', albumId: 'r-1' },
        candidates: [],
      }),
    ).toBe('matched your pinned release, but low confidence');
  });
});

describe('penaltyLabel', () => {
  it('glosses known penalty keys and passes unknown ones through', () => {
    expect(penaltyLabel('album_id')).toBe('different release');
    expect(penaltyLabel('data_source')).toBe('metadata source');
    expect(penaltyLabel('missing_tracks')).toBe('missing tracks');
    expect(penaltyLabel('some_future_key')).toBe('some_future_key');
  });
});

describe('isRetag', () => {
  it('is true only when a mapped file’s current title differs from the proposed title', () => {
    expect(isRetag({ path: 'a', title: 'Love Me Do', index: 1 })).toBe(false);
    expect(
      isRetag({
        path: 'a',
        title: 'Love Me Do',
        index: 1,
        current: { title: 'Love Me Do', artist: 'x', track: 1, length: 1 },
      }),
    ).toBe(false);
    expect(
      isRetag({
        path: 'a',
        title: 'Love Me Do',
        index: 1,
        current: { title: 'Luv Me Do', artist: 'x', track: 1, length: 1 },
      }),
    ).toBe(true);
  });

  it('scopes the retag mark to the title column: an artist-only change is not flagged', () => {
    // The diff table shows only titles, so the badge deliberately tracks the title, not artist/track.
    expect(
      isRetag({
        path: 'a',
        title: 'Love Me Do',
        index: 1,
        current: { title: 'Love Me Do', artist: 'Wrong Artist', track: 9 },
      }),
    ).toBe(false);
  });
});

describe('albumFieldList', () => {
  const full = {
    year: 1988,
    media: '8cm CD',
    label: 'Parlophone',
    catalognum: 'CD3R 4949',
    country: 'XE',
    albumDisambig: 'mini CD',
  };

  it('lists every populated field as a labelled row', () => {
    expect(albumFieldList(full)).toEqual([
      { label: 'Year', value: '1988' },
      { label: 'Media', value: '8cm CD' },
      { label: 'Label', value: 'Parlophone' },
      { label: 'Catalog #', value: 'CD3R 4949' },
      { label: 'Country', value: 'XE' },
      { label: 'Disambiguation', value: 'mini CD' },
    ]);
  });

  it('drops empty, zero, and the matcher’s `[none]` placeholder fields', () => {
    expect(
      albumFieldList({
        year: 0,
        media: '',
        label: '[none]',
        catalognum: '[none]',
        country: '',
        albumDisambig: '',
      }),
    ).toEqual([]);
  });

  it('keeps only the populated fields of a partial candidate', () => {
    expect(albumFieldList({ ...full, media: '', catalognum: '[none]', albumDisambig: '' })).toEqual(
      [
        { label: 'Year', value: '1988' },
        { label: 'Label', value: 'Parlophone' },
        { label: 'Country', value: 'XE' },
      ],
    );
  });
});

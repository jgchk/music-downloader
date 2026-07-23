import { describe, expect, it } from 'vitest';
import type { PendingReviewDto } from '@music/importer';
import {
  albumFieldList,
  contextSummary,
  formatDistance,
  hintNote,
  isRetag,
  kindLabel,
  penaltyLabel,
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
    ).toBe('2 candidates — best 12.3% away (the release you pinned was not the best match)');
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
    ).toBe('1 candidate — best 12.3% away (matched your pinned release, but low confidence)');
  });

  it('falls back to a neutral note for a legacy hinted review with no pinned id', () => {
    expect(
      contextSummary(pending({ kind: 'match-review', hinted: true, candidates: [candidate] })),
    ).toBe('1 candidate — best 12.3% away (a release was hinted)');
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
  it('glosses known beets penalty keys and passes unknown ones through', () => {
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

  it('drops empty, zero, and beets `[none]` placeholder fields', () => {
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

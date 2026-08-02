import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import CandidateTable from './CandidateTable.svelte';

const candidate = {
  ref: { dataSource: 'MusicBrainz', albumId: 'r-1' },
  artist: 'A',
  album: 'L',
  distance: 0.031,
  penalties: [{ name: 'tracks', amount: 0.02 }],
  tracks: [{ path: '/in/01.flac', title: 'One', index: 1 }],
};

const enriched = {
  ...candidate,
  distance: 0.2,
  penalties: [{ name: 'album_id', amount: 0.1 }],
  tracks: [
    {
      path: '/in/01.flac',
      title: 'Love Me Do',
      index: 1,
      current: { title: 'Luv Me Do', artist: 'A', track: 1, length: 143 },
      distance: 0.12,
    },
  ],
  extraItems: [
    { path: '/in/99.flac', title: 'Bonus Beatz', track: 9 },
    // An untitled extra falls back to its filename.
    { path: '/in/98 Untitled.flac', title: '', track: 10 },
  ],
  missingTracks: [{ title: 'P.S. I Love You', index: 2 }],
  albumFields: {
    year: 1988,
    media: '8cm CD',
    label: 'Parlophone',
    catalognum: 'CD3R 4949',
    country: 'XE',
    albumDisambig: 'mini CD',
  },
};

describe('CandidateTable (SSR)', () => {
  it('headlines coarse higher-is-better quality with raw identifiers only in disclosure', () => {
    const { body } = render(CandidateTable, { props: { candidates: [candidate] } });
    expect(body).toContain('A — L');
    // 0.031 → 97%: coarse, higher-is-better, categorized.
    expect(body).toContain('Strong match — 97%');
    // Raw source · id pairs and lower-is-better percentages left layer 1.
    expect(body).not.toContain('MusicBrainz · r-1');
    expect(body).not.toContain('3.1%');
    expect(body).not.toContain('away');
    expect(body).not.toContain(' off');
    // The disclosure holds them, behind a strong-scent summary.
    expect(body).toContain('data-testid="matching-details"');
    expect(body).toContain('Matching details — source, release ID, raw score');
    expect(body).toContain('MusicBrainz');
    expect(body).toContain('r-1');
    expect(body).toContain('0.031');
    // Penalty reasons stay visible, glossed, without amounts; amounts live in the disclosure.
    expect(body).toContain('track differences');
    expect(body).toContain('2.0%');
    expect(body).toContain('value="apply-candidate"');
    expect(body).toContain('Approve this match');
    expect(body).not.toContain('data-testid="duplicate-action"');
  });

  it('keeps penalty amounts out of the visible score line', () => {
    const { body } = render(CandidateTable, { props: { candidates: [candidate] } });
    const visible = body.split('data-testid="matching-details"', 1)[0] ?? '';
    expect(visible).toContain('track differences');
    expect(visible).not.toContain('2.0%');
  });

  it('renders the concrete field-level differences with word-level highlighting', () => {
    const { body } = render(CandidateTable, { props: { candidates: [enriched] } });
    expect(body).toContain('data-testid="album-fields"');
    expect(body).toContain('Parlophone');
    expect(body).toContain('8cm CD');
    expect(body).toContain('data-testid="track-diff"');
    // Direction is explicit: the columns name current and proposed.
    expect(body).toContain('Currently tagged');
    expect(body).toContain('Will become');
    // The changed word carries a highlight mark on each side; the shared words render plain.
    expect(body).toContain('<mark>Luv</mark>');
    expect(body).toContain('<mark>Love</mark>');
    expect(body).toContain('data-testid="retag"');
    expect(body).toContain('data-testid="extra-item"');
    expect(body).toContain('Bonus Beatz');
    expect(body).toContain('98 Untitled.flac');
    expect(body).toContain('data-testid="missing-track"');
    expect(body).toContain('P.S. I Love You');
    expect(body).toContain('different release');
  });

  it('de-emphasizes unchanged rows and leaves them unmarked', () => {
    const clean = {
      ...enriched,
      tracks: [
        {
          path: '/in/01.flac',
          title: 'Love Me Do',
          index: 1,
          current: { title: 'Love Me Do', artist: 'A', track: 1, length: 143 },
          distance: 0,
        },
      ],
      extraItems: [],
      missingTracks: [],
    };
    const { body } = render(CandidateTable, { props: { candidates: [clean] } });
    expect(body).toContain('class="unchanged"');
    expect(body).not.toContain('<mark>');
    expect(body).not.toContain('data-testid="retag"');
    expect(body).not.toContain('data-testid="extra-item"');
    expect(body).not.toContain('data-testid="missing-track"');
  });

  it('omits the album-fields panel when every field is empty or a placeholder', () => {
    const blank = {
      ...enriched,
      albumFields: {
        year: 0,
        media: '',
        label: '[none]',
        catalognum: '[none]',
        country: '',
        albumDisambig: '',
      },
    };
    const { body } = render(CandidateTable, { props: { candidates: [blank] } });
    expect(body).not.toContain('data-testid="album-fields"');
  });

  it('falls back to a quality-only view for a legacy candidate with no diff evidence', () => {
    const legacy = { ...candidate, tracks: [], penalties: [] };
    const { body } = render(CandidateTable, { props: { candidates: [legacy] } });
    expect(body).not.toContain('data-testid="album-fields"');
    expect(body).not.toContain('data-testid="track-diff"');
    expect(body).toContain('Strong match — 97%');
    expect(body).toContain('clean match');
    expect(body).toContain('data-testid="apply"');
  });

  it('renders the duplicate action with outcome-named choices when asked', () => {
    const { body } = render(CandidateTable, {
      props: { candidates: [candidate], withDuplicateAction: true },
    });
    expect(body).toContain('data-testid="duplicate-action"');
    expect(body).toContain('value="keep-both"');
    expect(body).toContain('Replace the existing copy');
    expect(body).toContain('Keep both copies');
  });
});

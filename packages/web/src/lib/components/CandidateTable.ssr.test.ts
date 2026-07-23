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
  it('renders a candidate with a distance, glossed penalties, and an apply form', () => {
    const { body } = render(CandidateTable, { props: { candidates: [candidate] } });
    expect(body).toContain('A — L');
    expect(body).toContain('MusicBrainz · r-1');
    expect(body).toContain('3.1%');
    // The raw beets key is glossed, not shown bare.
    expect(body).toContain('track differences 2.0%');
    expect(body).not.toContain('tracks 2.0%');
    expect(body).toContain('value="apply-candidate"');
    expect(body).toContain('value="r-1"');
    expect(body).not.toContain('data-testid="duplicate-action"');
  });

  it('renders the concrete field-level differences for an enriched candidate', () => {
    const { body } = render(CandidateTable, { props: { candidates: [enriched] } });
    // The album-field (release-details) panel.
    expect(body).toContain('data-testid="album-fields"');
    expect(body).toContain('Parlophone');
    expect(body).toContain('8cm CD');
    // The per-track diff: current title beside proposed, marked as a retag.
    expect(body).toContain('data-testid="track-diff"');
    expect(body).toContain('Luv Me Do');
    expect(body).toContain('Love Me Do');
    expect(body).toContain('data-testid="retag"');
    // The unmatched download and the missing candidate track.
    expect(body).toContain('data-testid="extra-item"');
    expect(body).toContain('Bonus Beatz');
    expect(body).toContain('98 Untitled.flac');
    expect(body).toContain('data-testid="missing-track"');
    expect(body).toContain('P.S. I Love You');
    expect(body).toContain('different release 10.0%');
  });

  it('omits the album-fields panel when every field is empty or a beets placeholder', () => {
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

  it('falls back to a score-only view for a legacy candidate with no diff evidence', () => {
    const legacy = { ...candidate, tracks: [], penalties: [] };
    const { body } = render(CandidateTable, { props: { candidates: [legacy] } });
    expect(body).not.toContain('data-testid="album-fields"');
    expect(body).not.toContain('data-testid="track-diff"');
    expect(body).toContain('clean match');
    expect(body).toContain('data-testid="apply"');
  });

  it('shows a track without a retag mark when the current title already matches', () => {
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
    expect(body).toContain('data-testid="track-diff"');
    expect(body).not.toContain('data-testid="retag"');
    expect(body).not.toContain('data-testid="extra-item"');
    expect(body).not.toContain('data-testid="missing-track"');
  });

  it('renders the duplicate action when asked', () => {
    const { body } = render(CandidateTable, {
      props: { candidates: [candidate], withDuplicateAction: true },
    });
    expect(body).toContain('data-testid="duplicate-action"');
    expect(body).toContain('keep-both');
  });
});

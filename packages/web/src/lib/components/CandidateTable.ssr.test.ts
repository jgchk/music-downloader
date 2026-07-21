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

describe('CandidateTable (SSR)', () => {
  it('renders candidates with distance, penalties, and an apply form', () => {
    const { body } = render(CandidateTable, { props: { candidates: [candidate] } });
    expect(body).toContain('A — L');
    expect(body).toContain('3.1%');
    expect(body).toContain('tracks 2.0%');
    expect(body).toContain('value="apply-candidate"');
    expect(body).toContain('value="r-1"');
    expect(body).not.toContain('data-testid="duplicate-action"');
  });

  it('renders a penalty-free candidate and the duplicate action when asked', () => {
    const { body } = render(CandidateTable, {
      props: {
        candidates: [{ ...candidate, penalties: [] }],
        withDuplicateAction: true,
      },
    });
    expect(body).toContain('none');
    expect(body).toContain('data-testid="duplicate-action"');
    expect(body).toContain('keep-both');
  });
});

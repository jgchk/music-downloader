import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import CatalogDetail from './CatalogDetail.svelte';
import type { DetailState, TracklistState } from '$lib/search/detail.js';

const RG = '19847822-1430-3380-9cf1-bc45545b34ac';
const PICK = '1b022e01-4da6-387b-8658-8678046e4cef';

const noop = (): void => {};

const edition = (mbid: string, overrides: Record<string, unknown> = {}) => ({
  mbid,
  title: 'Graceland',
  formats: 'CD',
  trackCount: 11,
  date: '1986-08-29',
  country: 'DE',
  ...overrides,
});

const body = (detail: DetailState, tracklists: Record<string, TracklistState> = {}): string =>
  render(CatalogDetail, {
    props: { detail, tracklists, onTracklist: noop, onClose: noop },
  }).body;

const releaseGroup = (bestMatch: {
  kind: 'pick' | 'selection-required';
  mbid?: string;
}): DetailState => ({
  kind: 'release-group',
  mbid: RG,
  title: 'Graceland',
  editions: {
    groups: [{ trackCount: 11, representative: edition(PICK), editions: [edition(PICK)] }],
    bestMatch,
  },
});

describe('CatalogDetail (SSR)', () => {
  it('renders nothing at all while nothing is open', () => {
    expect(
      render(CatalogDetail, {
        props: { detail: undefined, tracklists: {}, onTracklist: noop, onClose: noop },
      }).body.trim(),
    ).not.toContain('<aside');
  });

  it('says it is reading the catalog while it has nothing to show', () => {
    expect(body({ kind: 'loading', title: 'Graceland' })).toContain('Reading the catalog');
  });

  it('reports a catalog it could not read as an alert, not as an empty list', () => {
    const html = body({ kind: 'failed', title: 'Graceland', message: 'Could not be reached.' });

    expect(html).toContain('role="alert"');
    expect(html).toContain('Could not be reached.');
  });

  it('names the system’s default edition in words a reader can act on', () => {
    const html = body(releaseGroup({ kind: 'pick', mbid: PICK }));

    expect(html).toContain('the system’s default');
    expect(html).toContain('1986-08-29 · DE · CD · 11 tracks');
    expect(html).toContain('most common');
  });

  it('says when the system would ask rather than choose for itself', () => {
    const html = body(releaseGroup({ kind: 'selection-required' }));

    expect(html).toContain('ask you to choose');
    expect(html).not.toContain('the system’s default');
  });

  it('names an edition’s disambiguation, which is often all that tells two apart', () => {
    const html = body({
      kind: 'release-group',
      mbid: RG,
      title: 'Graceland',
      editions: {
        groups: [
          {
            trackCount: 11,
            representative: edition(PICK, { disambiguation: 'UK limited edition gatefold' }),
            editions: [edition(PICK, { disambiguation: 'UK limited edition gatefold' })],
          },
        ],
        bestMatch: { kind: 'pick', mbid: PICK },
      },
    });

    expect(html).toContain('UK limited edition gatefold');
  });

  it('requests the album itself until a pressing is chosen', () => {
    const html = body(releaseGroup({ kind: 'pick', mbid: PICK }));

    expect(html).toContain('value="release-group"');
    expect(html).toContain(`value="${RG}"`);
    expect(html).toContain('Request download');
  });

  it('renders a tracklist that has been read, and says so while it is being read', () => {
    const reading = body(releaseGroup({ kind: 'pick', mbid: PICK }), {
      [PICK]: { kind: 'loading' },
    });
    const read = body(releaseGroup({ kind: 'pick', mbid: PICK }), {
      [PICK]: {
        kind: 'loaded',
        tracklist: {
          tracks: [{ position: 1, title: 'The Boy in the Bubble', durationMs: 239_000 }],
        },
      },
    });
    const failed = body(releaseGroup({ kind: 'pick', mbid: PICK }), {
      [PICK]: { kind: 'failed', message: 'Could not read the tracklist.' },
    });

    expect(reading).toContain('Reading the tracklist');
    expect(read).toContain('The Boy in the Bubble');
    expect(read).toContain('3:59');
    expect(failed).toContain('Could not read the tracklist.');
  });

  it('renders an artist’s releases with a request each, and what the catalog knows of them', () => {
    const html = body({
      kind: 'artist',
      mbid: RG,
      title: 'Paul Simon',
      discography: {
        releaseGroups: [
          {
            mbid: PICK,
            title: 'Graceland',
            artistCredit: 'Paul Simon',
            year: 1986,
            primaryType: 'Album',
            secondaryTypes: [],
          },
          {
            mbid: RG,
            title: 'Undated',
            artistCredit: 'Paul Simon',
            year: undefined,
            primaryType: undefined,
            secondaryTypes: [],
          },
        ],
      },
    });

    expect(html).toContain('Graceland');
    expect(html).toContain('1986 · Album');
    expect(html).toContain('Undated');
    expect(html).toContain('class="request-form"');
  });

  it('renders a track’s own request, as a track', () => {
    const html = body({ kind: 'recording', mbid: PICK, title: 'The Boy in the Bubble' });

    expect(html).toContain('value="track"');
    expect(html).toContain('Request this track');
    expect(html).toContain('Quality floor');
  });

  it('renders an empty edition list without pretending there is a choice', () => {
    const html = body({
      kind: 'release-group',
      mbid: RG,
      title: 'Graceland',
      editions: { groups: [], bestMatch: { kind: 'selection-required' } },
    });

    expect(html).toContain('ask you to choose');
    expect(html).not.toContain('View tracklist');
  });
});

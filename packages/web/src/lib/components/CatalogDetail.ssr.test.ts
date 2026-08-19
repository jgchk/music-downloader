import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import CatalogDetail from './CatalogDetail.svelte';
import type { DetailState, ChosenEdition, TracklistState } from '$lib/search/detail.js';

const RG = '19847822-1430-3380-9cf1-bc45545b34ac';
const PICK = '1b022e01-4da6-387b-8658-8678046e4cef';

const noop = (): void => {};

const edition = (mbid: string, overrides: Record<string, unknown> = {}) => ({
  mbid,
  title: 'Graceland',
  formats: ['CD'],
  trackCount: 11,
  date: '1986-08-29',
  country: 'DE',
  ...overrides,
});

const body = (
  detail: DetailState,
  tracklists: Record<string, TracklistState> = {},
  chosen?: ChosenEdition,
): string =>
  render(CatalogDetail, {
    props: { detail, tracklists, onTracklist: noop, chosen, onChoose: noop, onClose: noop },
  }).body;

const releaseGroup = (bestMatch: {
  kind: 'pick' | 'selection-required';
  mbid?: string;
}): DetailState => ({
  kind: 'release-group',
  mbid: RG,
  title: 'Graceland',
  editions: {
    groups: [{ representative: edition(PICK), editions: [edition(PICK)] }],
    bestMatch,
  },
});

describe('CatalogDetail (SSR)', () => {
  it('names the pick even when the catalog says nothing else about it', () => {
    const bare = { mbid: PICK, title: 'Graceland', formats: [] as string[] };
    const html = body({
      kind: 'release-group',
      mbid: RG,
      title: 'Graceland',
      editions: {
        groups: [{ representative: bare, editions: [bare] }],
        bestMatch: { kind: 'pick', mbid: PICK },
      },
    });

    // No date, no country, no format, no track count — so there is no detail line to draw, and
    // an empty one under the title would read as a fact the catalog stated.
    expect(html).toContain('The system would take');
    expect(html).not.toContain('edition-summary"></span>');
  });

  it('names what it is showing, beyond the bare title', () => {
    const html = body({
      ...releaseGroup({ kind: 'pick', mbid: PICK }),
      artistCredit: 'Paul Simon',
      year: 1986,
      primaryType: 'Album',
    });

    // Everything here was already on the card that was clicked — no second read buys it.
    expect(html).toContain('Paul Simon');
    expect(html).toContain('1986');
    expect(html).toContain('Album');
    // And the identifier, which is where someone checks they opened the right record.
    expect(html).toContain(RG);
  });

  it('leaves out what the catalog never said, rather than placeholding it', () => {
    const html = body({
      ...releaseGroup({ kind: 'pick', mbid: PICK }),
      artistCredit: 'Paul Simon',
    });

    expect(html).toContain('Paul Simon');
    expect(html).not.toContain('Unknown');
  });

  it('says nothing about what the catalog did not say', () => {
    // The catalog names neither a release nor an artist credit for this track. Every line the
    // view would have drawn from them is absent, rather than drawn empty.
    const html = body({
      kind: 'recording',
      mbid: 'e7f1a1b8-51ee-4e0a-a3b6-6f1a5a4de1a2',
      title: 'The Boy in the Bubble',
      artistCredit: '',
    });

    expect(html).not.toContain('from ');
    expect(html).not.toContain('/cover-art/release/');
    expect(html).not.toContain('detail-subtitle');
  });

  it('gives a track the release it came from, and that release’s artwork', () => {
    const html = body({
      kind: 'recording',
      mbid: 'e7f1a1b8-51ee-4e0a-a3b6-6f1a5a4de1a2',
      title: 'The Boy in the Bubble',
      artistCredit: 'Paul Simon',
      release: { mbid: PICK, title: 'Graceland' },
    });

    // A track is a track OF something; without this the panel is a title and a button.
    expect(html).toContain('from Graceland');
    expect(html).toContain(`/cover-art/release/${PICK}?size=500`);
  });

  it('requests the chosen pressing, said in words, once one has been chosen', () => {
    // The component is a pure function of its props — the choice is markup, not something a
    // browser-only effect paints in afterwards. (Nothing persists the choice across a reload; the
    // page holds it, and that is deliberate.)
    const html = body(releaseGroup({ kind: 'pick', mbid: PICK }), {}, { album: RG, edition: PICK });

    expect(html).toContain('>chosen<');
    expect(html).toContain('Request this edition');
    expect(html).toContain('name="targetType" value="album"');
    expect(html).toContain(`name="mbid" value="${PICK}"`);
  });

  it('ignores a pressing chosen on a different album', () => {
    const html = body(
      releaseGroup({ kind: 'pick', mbid: PICK }),
      {},
      { album: 'another-album', edition: PICK },
    );

    expect(html).toContain('Request download');
    expect(html).toContain(`name="kind" value="release-group"`);
  });

  it('renders an edition the catalog has not named, and one it has not typed', () => {
    const bare = { ...edition(PICK), title: '', disambiguation: undefined, formats: [] };
    const html = body({
      kind: 'release-group',
      mbid: RG,
      title: 'Graceland',
      editions: {
        groups: [{ representative: bare, editions: [bare] }],
        bestMatch: { kind: 'pick', mbid: PICK },
      },
    });

    expect(html).toContain('1986-08-29');
    expect(html).toContain('11 tracks');
  });

  it('renders nothing at all while nothing is open', () => {
    expect(
      render(CatalogDetail, {
        props: {
          detail: undefined,
          tracklists: {},
          onTracklist: noop,
          chosen: undefined,
          onChoose: noop,
          onClose: noop,
        },
      }).body.trim(),
    ).not.toContain('<aside');
  });

  it('says it is reading the catalog while it has nothing to show', () => {
    expect(body({ kind: 'loading', mbid: RG, title: 'Graceland' })).toContain(
      'Reading the catalog',
    );
  });

  it('reports a catalog it could not read as an alert, not as an empty list', () => {
    const html = body({
      kind: 'failed',
      mbid: RG,
      title: 'Graceland',
      message: 'Could not be reached.',
    });

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

    expect(html).toContain('ask you to pick one');
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

  it('says an artist has no releases listed, rather than heading an empty list', () => {
    // The album arm says so; the artist arm rendered "Releases" over nothing at all, which reads
    // as a page that failed rather than a catalog that knows of none.
    const html = body({
      kind: 'artist',
      mbid: RG,
      title: 'Paul Simon',
      discography: { releaseGroups: [] },
    });

    expect(html).toContain('lists no releases under this artist');
  });

  it('says the catalog listed no pressings, rather than offering a choice of none', () => {
    // "Pick one" above an empty list is a confident dead end; the honest sentence is that the
    // catalog told us nothing about this album's pressings.
    const html = body({
      kind: 'release-group',
      mbid: RG,
      title: 'Graceland',
      editions: { groups: [], bestMatch: { kind: 'selection-required' } },
    });

    expect(html).toContain('lists no pressings');
    expect(html).not.toContain('pick one');
    expect(html).not.toContain('View tracklist');
  });
});

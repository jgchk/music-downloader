import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import CatalogResults from './CatalogResults.svelte';
import type { CatalogSearchResultDto } from '@music/downloader';

const RG = '19847822-1430-3380-9cf1-bc45545b34ac';
const ARTIST = '4d5447d7-c61c-4120-ba1b-d7f471d385b9';
const RECORDING = '0b6b4ba0-d36f-47bd-b4ea-6a5b91842d29';
const RELEASE = '1b022e01-4da6-387b-8658-8678046e4cef';

const noop = (): void => {};

function results(overrides: Partial<CatalogSearchResultDto> = {}): CatalogSearchResultDto {
  return {
    leading: 'release-group',
    releaseGroups: [
      {
        mbid: RG,
        title: 'Graceland',
        artistCredit: 'Paul Simon',
        year: 1986,
        primaryType: 'Album',
        secondaryTypes: [],
      },
    ],
    artists: [{ mbid: ARTIST, name: 'Paul Simon', disambiguation: 'US singer' }],
    recordings: [
      {
        mbid: RECORDING,
        title: 'The Boy in the Bubble',
        artistCredit: 'Paul Simon',
        release: { mbid: RELEASE, title: 'Graceland' },
      },
    ],
    ...overrides,
  };
}

const body = (overrides: Record<string, unknown> = {}): string =>
  render(CatalogResults, {
    props: {
      results: results(),
      filter: 'all',
      query: 'paul simon graceland',
      onOpen: noop,
      onFilter: noop,
      ...overrides,
    },
  }).body;

describe('CatalogResults (SSR)', () => {
  it('says a kind could not be read, rather than letting it read as nothing matching', () => {
    // An empty block means "nothing matched" OR "nobody could ask"; a person told the first will
    // change their spelling, and the spelling was never the problem.
    const html = body({
      results: results({
        artists: [],
        unavailable: [{ kind: 'artist', reason: 'unreachable' }],
      }),
    });

    expect(html).toContain('could not be reached for artists');
  });

  it('says a kind whose answer could not be READ is a bug, not a connection to check', () => {
    // Drift is not unreachability: the catalog answered, in a shape this page cannot present, and
    // no amount of retrying by this person will change that.
    const html = body({
      results: results({ artists: [], unavailable: [{ kind: 'artist', reason: 'unreadable' }] }),
    });

    expect(html).toContain('could not read');
    expect(html).toContain('That is a bug, not your search');
  });

  it('says so even when the unreadable kind is not the one being looked at', () => {
    // Filtered to albums, which matched nothing, while the artist read failed: a notice living
    // inside the artists section would not be on screen to be read.
    const html = body({
      filter: 'release-group',
      results: results({
        releaseGroups: [],
        artists: [],
        unavailable: [{ kind: 'artist', reason: 'unreachable' }],
      }),
    });

    expect(html).toContain('could not be reached for artists');
  });

  it('renders every kind with the hooks the skins style, in the catalog’s own order', () => {
    const html = body();

    // The sequence, not two indexes: an absent section indexes as -1, which sorts before anything.
    expect(
      html
        .matchAll(/data-kind="([^"]+)"/g)
        .map((match) => match[1])
        .toArray(),
    ).toEqual(['release-group', 'artist', 'recording']);
    expect(html).toContain('class="art-grid"');
    expect(html).toContain('class="artist-row"');
    expect(html).toContain('class="track-rows"');
  });

  it('renders each result’s request as a real form, so it works before any script runs', () => {
    const html = body();

    expect(html).toContain('action="/acquisitions/new"');
    expect(html).toContain('name="mbid" value="19847822-1430-3380-9cf1-bc45545b34ac"');
    expect(html).toContain('value="release-group"');
  });

  it('reserves the artwork slot and names what it stands for, before any image loads', () => {
    const html = body();

    expect(html).toContain(`/cover-art/release-group/${RG}?size=250`);
    expect(html).toContain('class="art-placeholder"');
    expect(html).toContain('>PS<'); // the initials the placeholder shows
  });

  it('renders a track with no release without an artwork request it cannot make', () => {
    const html = body({
      results: results({
        recordings: [
          { mbid: RECORDING, title: 'Unreleased', artistCredit: 'Paul Simon', release: undefined },
        ],
      }),
    });

    expect(html).not.toContain('/cover-art/release/');
    expect(html).toContain('Unreleased');
  });

  it('falls back to naming an artist as an artist when the catalog offers nothing more', () => {
    const html = body({
      results: results({
        releaseGroups: [],
        recordings: [],
        artists: [{ mbid: ARTIST, name: 'Paul Simon', disambiguation: undefined }],
      }),
    });

    // Asserted on the line that carries it: the section heading "Artists" would satisfy a bare
    // substring check whether or not the fallback exists.
    expect(html).toContain('class="result-detail">Artist<');
  });

  it('names the query and where else it matched, when the filtered kind matched nothing', () => {
    const html = body({ results: results({ recordings: [] }), filter: 'recording' });

    expect(html).toContain('No tracks matched');
    expect(html).toContain('paul simon graceland');
    // Counted in the singular when there is one — "1 albums" is the defect this pins.
    expect(html).toContain('>1 album<');
    expect(html).toContain('1 artist');
  });

  it('says plainly when nothing matched anywhere', () => {
    const html = body({
      results: results({ releaseGroups: [], artists: [], recordings: [] }),
    });

    expect(html).toContain('Nothing matched');
    expect(html).toContain('paste a MusicBrainz ID');
  });

  it('renders an album with no year or type without leaving punctuation behind', () => {
    const html = body({
      results: results({
        artists: [],
        recordings: [],
        releaseGroups: [
          {
            mbid: RG,
            title: 'Untitled Year',
            artistCredit: 'Paul Simon',
            year: undefined,
            primaryType: undefined,
            secondaryTypes: [],
          },
        ],
      }),
    });

    expect(html).toContain('Untitled Year');
    expect(html).not.toContain('Paul Simon ·');
  });
});

import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { describe, expect, it, vi } from 'vitest';
import CatalogResults from './CatalogResults.svelte';
import type { CatalogSearchResultDto } from '@music/downloader';

const RG = '19847822-1430-3380-9cf1-bc45545b34ac';
const ARTIST = '4d5447d7-c61c-4120-ba1b-d7f471d385b9';
const RECORDING = '0b6b4ba0-d36f-47bd-b4ea-6a5b91842d29';
const RELEASE = '1b022e01-4da6-387b-8658-8678046e4cef';

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

const props = (overrides: Record<string, unknown> = {}) => ({
  results: results(),
  filter: 'all' as const,
  query: 'paul simon graceland',
  onOpen: vi.fn(),
  onFilter: vi.fn(),
  ...overrides,
});

describe('CatalogResults', () => {
  it('shows each kind of result in its own shape, so they are told apart at a glance', async () => {
    await render(CatalogResults, props());

    await expect.element(page.getByRole('heading', { name: /Albums/ })).toBeVisible();
    await expect.element(page.getByRole('heading', { name: /Artists/ })).toBeVisible();
    await expect.element(page.getByRole('heading', { name: /Tracks/ })).toBeVisible();
    expect(document.querySelector('.art-grid')).not.toBeNull();
    expect(document.querySelector('.artist-row')).not.toBeNull();
    expect(document.querySelector('.track-rows')).not.toBeNull();
  });

  it('leads with the kind the catalog says the query was asking about', async () => {
    await render(CatalogResults, props({ results: results({ leading: 'recording' }) }));

    const sections = [...document.querySelectorAll<HTMLElement>('section.results')];
    expect(sections.map((section) => section.dataset.kind)).toEqual([
      'recording',
      'release-group',
      'artist',
    ]);
  });

  it('offers a request for an album that names the album, not one of its pressings', async () => {
    await render(CatalogResults, props());

    const form = document.querySelector<HTMLFormElement>('.art-grid .request-form')!;
    expect(new FormData(form).get('kind')).toBe('release-group');
    expect(new FormData(form).get('mbid')).toBe(RG);
    expect(form.method.toUpperCase()).toBe('POST');
  });

  it('offers a request for a track as a track', async () => {
    await render(CatalogResults, props());

    const form = document.querySelector<HTMLFormElement>('.track-rows .request-form')!;
    expect(new FormData(form).get('kind')).toBe('musicbrainz');
    expect(new FormData(form).get('targetType')).toBe('track');
    expect(new FormData(form).get('mbid')).toBe(RECORDING);
  });

  it('shows the request action without waiting for a pointer to find it', async () => {
    await render(CatalogResults, props());

    // Every request action is in the document and visible from the start: a hover-revealed
    // primary action is unreachable on a touch screen.
    const requests = page.getByRole('button', { name: 'Request' }).all();
    for (const button of requests) {
      await expect.element(button).toBeVisible();
    }
  });

  it('asks for artwork through this application, at the size the grid renders', async () => {
    await render(CatalogResults, props());

    const image = document.querySelector('.art-grid img')!;
    expect(image.getAttribute('src')).toBe(`/cover-art/release-group/${RG}?size=250`);
    expect(image.getAttribute('loading')).toBe('lazy');
  });

  it('opens the detail surface for whatever was clicked', async () => {
    const onOpen = vi.fn();
    await render(CatalogResults, props({ onOpen }));

    await page
      .getByRole('button', { name: /Graceland/ })
      .first()
      .click();

    expect(onOpen).toHaveBeenCalledWith('release-group', RG, 'Graceland');
  });

  it('sends an artist to their releases rather than requesting them all', async () => {
    await render(CatalogResults, props());

    await expect.element(page.getByText('Browse releases')).toBeVisible();
    expect(document.querySelector('.artist-row .request-form')).toBeNull();
  });

  it('renders a track that sits on no release, with no artwork to ask for', async () => {
    await render(
      CatalogResults,
      props({
        results: results({
          artists: [],
          releaseGroups: [],
          recordings: [
            {
              mbid: RECORDING,
              title: 'Unreleased',
              artistCredit: 'Paul Simon',
              release: undefined,
            },
          ],
        }),
      }),
    );

    await expect.element(page.getByText('Unreleased')).toBeVisible();
    expect(document.querySelector('.track-rows img')).toBeNull();
  });

  it('renders an album the catalog has not dated or typed', async () => {
    await render(
      CatalogResults,
      props({
        results: results({
          artists: [],
          recordings: [],
          releaseGroups: [
            {
              mbid: RG,
              title: 'Undated',
              artistCredit: 'Paul Simon',
              year: undefined,
              primaryType: undefined,
              secondaryTypes: [],
            },
          ],
        }),
      }),
    );

    await expect.element(page.getByText('Undated')).toBeVisible();
  });

  it('names an artist the catalog offers nothing more about as an artist', async () => {
    await render(
      CatalogResults,
      props({
        results: results({
          releaseGroups: [],
          recordings: [],
          artists: [{ mbid: ARTIST, name: 'Paul Simon', disambiguation: undefined }],
        }),
      }),
    );

    await expect.element(page.getByText('Artist', { exact: true })).toBeVisible();
  });

  it('names the query and the way out when the filtered kind matched nothing', async () => {
    const onFilter = vi.fn();
    await render(
      CatalogResults,
      props({ results: results({ recordings: [] }), filter: 'recording', onFilter }),
    );

    await expect.element(page.getByTestId('no-matches')).toBeVisible();
    await expect.element(page.getByText('paul simon graceland', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: /albums/ }).click();

    expect(onFilter).toHaveBeenCalledWith('release-group');
  });

  it('says plainly when nothing matched anywhere, and how to go straight to a record', async () => {
    await render(
      CatalogResults,
      props({ results: results({ releaseGroups: [], artists: [], recordings: [] }) }),
    );

    await expect.element(page.getByTestId('no-matches')).toBeVisible();
    await expect.element(page.getByText(/paste a MusicBrainz ID/)).toBeVisible();
  });
});

import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import RequestSearch from './RequestSearch.svelte';
import type { CatalogClient } from '$lib/search/client.js';
import type { TypingDriver } from '$lib/search/typing.js';

const RG = '19847822-1430-3380-9cf1-bc45545b34ac';
const ARTIST = '4d5447d7-c61c-4120-ba1b-d7f471d385b9';
const RECORDING = '0b6b4ba0-d36f-47bd-b4ea-6a5b91842d29';
const RELEASE = '1b022e01-4da6-387b-8658-8678046e4cef';

const ARTIST_HIT = { mbid: ARTIST, name: 'Paul Simon', disambiguation: 'US singer' };
const TRACK_HIT = {
  mbid: RECORDING,
  title: 'The Boy in the Bubble',
  artistCredit: 'Paul Simon',
  release: { mbid: RELEASE, title: 'Graceland' },
};

const RESULTS = {
  leading: 'release-group' as const,
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
  artists: [],
  recordings: [],
};

/** A driver that settles only when a test says so, so no test waits out a debounce. */
function manualTyping(): TypingDriver & { settle_: () => void } {
  let pending: (() => void) | undefined;
  return {
    settle: (onSettled) => {
      pending = onSettled;
      return () => {
        pending = undefined;
      };
    },
    settle_: () => pending?.(),
  };
}

function catalogStub(
  overrides: Partial<CatalogClient> = {},
): CatalogClient & Record<string, ReturnType<typeof vi.fn>> {
  return {
    search: vi.fn(() => Promise.resolve({ ok: true, value: RESULTS })),
    lookup: vi.fn(() =>
      Promise.resolve({
        ok: true,
        value: { kind: 'artist', artist: { mbid: ARTIST, name: 'Paul Simon' } },
      }),
    ),
    discography: vi.fn(() => Promise.resolve({ ok: true, value: { releaseGroups: [] } })),
    editions: vi.fn(() =>
      Promise.resolve({
        ok: true,
        value: { groups: [], bestMatch: { kind: 'selection-required' } },
      }),
    ),
    tracklist: vi.fn(() => Promise.resolve({ ok: true, value: { tracks: [] } })),
    ...overrides,
  } as never;
}

describe('RequestSearch', () => {
  it('teaches what the box does before anything is typed', async () => {
    await render(RequestSearch, { catalog: catalogStub(), typing: manualTyping() });

    await expect.element(page.getByTestId('search-hint')).toBeVisible();
    await expect.element(page.getByText(/paste a MusicBrainz ID/i)).toBeVisible();
  });

  it('waits for the typing to settle before asking the catalog anything', async () => {
    const catalog = catalogStub();
    const typing = manualTyping();
    await render(RequestSearch, { catalog, typing });

    await page.getByTestId('catalog-query').fill('graceland');
    expect(catalog.search).not.toHaveBeenCalled();

    typing.settle_();
    await expect.element(page.getByText('Graceland')).toBeVisible();
    expect(catalog.search).toHaveBeenCalledWith('graceland', expect.anything());
  });

  it('searches at once when Enter says not to wait', async () => {
    const catalog = catalogStub();
    await render(RequestSearch, { catalog, typing: manualTyping() });

    await page.getByTestId('catalog-query').fill('graceland');
    await userEvent.keyboard('{Enter}');

    await expect.element(page.getByText('Graceland')).toBeVisible();
    expect(catalog.search).toHaveBeenCalledTimes(1);
  });

  it('asks nothing of the catalog for too little to search on', async () => {
    const catalog = catalogStub();
    const typing = manualTyping();
    await render(RequestSearch, { catalog, typing });

    await page.getByTestId('catalog-query').fill('g');
    typing.settle_();

    expect(catalog.search).not.toHaveBeenCalled();
    await expect.element(page.getByTestId('search-hint')).toBeVisible();
  });

  it('goes straight to the record a pasted identifier names, without searching for it', async () => {
    const catalog = catalogStub();
    await render(RequestSearch, { catalog, typing: manualTyping() });

    await page.getByTestId('catalog-query').fill(RG);
    await userEvent.keyboard('{Enter}');

    await expect.element(page.getByText('Paul Simon')).toBeVisible();
    expect(catalog.lookup).toHaveBeenCalledWith(RG, expect.anything());
    expect(catalog.search).not.toHaveBeenCalled();
  });

  it('says the catalog could not be reached, which is not the same as nothing matching', async () => {
    const catalog = catalogStub({
      search: vi.fn(() =>
        Promise.resolve({ ok: false as const, message: 'The catalog could not be reached.' }),
      ),
    });
    await render(RequestSearch, { catalog, typing: manualTyping() });

    await page.getByTestId('catalog-query').fill('graceland');
    await userEvent.keyboard('{Enter}');

    await expect.element(page.getByTestId('search-error')).toBeVisible();
    expect(document.querySelector('[data-testid="no-matches"]')).toBeNull();
  });

  it('narrows to one kind of result and back', async () => {
    await render(RequestSearch, { catalog: catalogStub(), typing: manualTyping() });
    await page.getByTestId('catalog-query').fill('graceland');
    await userEvent.keyboard('{Enter}');
    await expect.element(page.getByText('Graceland')).toBeVisible();

    await page.getByRole('button', { name: 'Artists' }).click();

    await expect.element(page.getByTestId('no-matches')).toBeVisible();
  });

  it('opens an album’s editions when it is chosen', async () => {
    const catalog = catalogStub();
    await render(RequestSearch, { catalog, typing: manualTyping() });
    await page.getByTestId('catalog-query').fill('graceland');
    await userEvent.keyboard('{Enter}');
    await expect.element(page.getByText('Graceland')).toBeVisible();

    await page
      .getByRole('button', { name: /Graceland/ })
      .first()
      .click();

    await expect.element(page.getByTestId('detail')).toBeVisible();
    expect(catalog.editions).toHaveBeenCalledWith(RG);
  });

  it('opens an artist onto their releases rather than their editions', async () => {
    const catalog = catalogStub({
      search: vi.fn(() =>
        Promise.resolve({
          ok: true as const,
          value: {
            ...RESULTS,
            leading: 'artist' as const,
            releaseGroups: [],
            artists: [ARTIST_HIT],
          },
        }),
      ),
      discography: vi.fn(() =>
        Promise.resolve({
          ok: true as const,
          value: { releaseGroups: [RESULTS.releaseGroups[0]!] },
        }),
      ),
    });
    await render(RequestSearch, { catalog, typing: manualTyping() });
    await page.getByTestId('catalog-query').fill('paul simon');
    await userEvent.keyboard('{Enter}');

    await page
      .getByRole('button', { name: /Paul Simon/ })
      .first()
      .click();

    // The results area BECOMES their releases — an artist is not something to peek at beside the
    // results, and a panel could not show their albums as albums.
    await expect.element(page.getByRole('heading', { name: 'Albums by Paul Simon' })).toBeVisible();
    expect(document.querySelectorAll('.art-grid > .result').length).toBeGreaterThan(0);
    expect(catalog.discography).toHaveBeenCalledWith(ARTIST);
    expect(catalog.editions).not.toHaveBeenCalled();
  });

  it('goes back to the results it was holding, without searching again', async () => {
    const catalog = catalogStub({
      search: vi.fn(() =>
        Promise.resolve({
          ok: true as const,
          value: { ...RESULTS, leading: 'artist' as const, artists: [ARTIST_HIT] },
        }),
      ),
      discography: vi.fn(() =>
        Promise.resolve({
          ok: true as const,
          value: { releaseGroups: [RESULTS.releaseGroups[0]!] },
        }),
      ),
    });
    await render(RequestSearch, { catalog, typing: manualTyping() });
    await page.getByTestId('catalog-query').fill('paul simon');
    await userEvent.keyboard('{Enter}');
    await page
      .getByRole('button', { name: /Paul Simon/ })
      .first()
      .click();
    await expect.element(page.getByTestId('back-to-results')).toBeVisible();

    await page.getByTestId('back-to-results').click();

    await expect.element(page.getByRole('heading', { name: /Artists/ })).toBeVisible();
    expect(catalog.search).toHaveBeenCalledTimes(1);
  });

  it('leaves an artist’s releases behind when a new query is typed', async () => {
    const catalog = catalogStub({
      search: vi.fn(() =>
        Promise.resolve({
          ok: true as const,
          value: { ...RESULTS, leading: 'artist' as const, artists: [ARTIST_HIT] },
        }),
      ),
      discography: vi.fn(() =>
        Promise.resolve({
          ok: true as const,
          value: { releaseGroups: [RESULTS.releaseGroups[0]!] },
        }),
      ),
    });
    await render(RequestSearch, { catalog, typing: manualTyping() });
    await page.getByTestId('catalog-query').fill('paul simon');
    await userEvent.keyboard('{Enter}');
    await page
      .getByRole('button', { name: /Paul Simon/ })
      .first()
      .click();
    await expect.element(page.getByTestId('back-to-results')).toBeVisible();

    await page.getByTestId('catalog-query').fill('something else');
    await userEvent.keyboard('{Enter}');

    // Their releases are an answer to a question nobody is asking any more.
    await expect.element(page.getByRole('heading', { name: /Artists/ })).toBeVisible();
    expect(document.querySelector('[data-testid="back-to-results"]')).toBeNull();
  });

  it('a filter tab leaves the artist and applies itself to the held results', async () => {
    const catalog = catalogStub({
      search: vi.fn(() =>
        Promise.resolve({
          ok: true as const,
          value: {
            ...RESULTS,
            leading: 'artist' as const,
            artists: [ARTIST_HIT],
            recordings: [TRACK_HIT],
          },
        }),
      ),
      discography: vi.fn(() =>
        Promise.resolve({
          ok: true as const,
          value: { releaseGroups: [RESULTS.releaseGroups[0]!] },
        }),
      ),
    });
    await render(RequestSearch, { catalog, typing: manualTyping() });
    await page.getByTestId('catalog-query').fill('paul simon');
    await userEvent.keyboard('{Enter}');
    await page
      .getByRole('button', { name: /Paul Simon/ })
      .first()
      .click();
    await expect.element(page.getByTestId('back-to-results')).toBeVisible();

    await page.getByRole('button', { name: 'Tracks', exact: true }).click();

    // The tabs stay honest: one of them cannot sit there filtering something nobody is looking at.
    expect(document.querySelector('[data-testid="back-to-results"]')).toBeNull();
    await expect.element(page.getByRole('heading', { name: /Tracks/ })).toBeVisible();
    expect(catalog.search).toHaveBeenCalledTimes(1);
  });

  it('says something when the conversation about an artist rejects outright', async () => {
    // Nothing should reject — the client turns every failure into a value — so this is a bug, and
    // a browse view that reads forever is the least debuggable way for one to surface.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    onTestFinished(() => consoleError.mockRestore());
    const catalog = catalogStub({
      search: vi.fn(() =>
        Promise.resolve({
          ok: true as const,
          value: { ...RESULTS, leading: 'artist' as const, artists: [ARTIST_HIT] },
        }),
      ),
      discography: vi.fn(() => Promise.reject(new Error('boom'))),
    });
    await render(RequestSearch, { catalog, typing: manualTyping() });
    await page.getByTestId('catalog-query').fill('paul simon');
    await userEvent.keyboard('{Enter}');

    await page
      .getByRole('button', { name: /Paul Simon/ })
      .first()
      .click();

    await expect.element(page.getByTestId('browse-error')).toBeVisible();
  });

  it('says an artist has no releases the catalog knows of', async () => {
    const catalog = catalogStub({
      search: vi.fn(() =>
        Promise.resolve({
          ok: true as const,
          value: { ...RESULTS, leading: 'artist' as const, artists: [ARTIST_HIT] },
        }),
      ),
      discography: vi.fn(() =>
        Promise.resolve({ ok: true as const, value: { releaseGroups: [] } }),
      ),
    });
    await render(RequestSearch, { catalog, typing: manualTyping() });
    await page.getByTestId('catalog-query').fill('paul simon');
    await userEvent.keyboard('{Enter}');

    await page
      .getByRole('button', { name: /Paul Simon/ })
      .first()
      .click();

    await expect.element(page.getByTestId('discography-empty')).toBeVisible();
  });

  it('opens a track without asking the catalog anything more about it', async () => {
    const catalog = catalogStub({
      search: vi.fn(() =>
        Promise.resolve({
          ok: true as const,
          value: {
            ...RESULTS,
            leading: 'recording' as const,
            releaseGroups: [],
            recordings: [TRACK_HIT],
          },
        }),
      ),
    });
    await render(RequestSearch, { catalog, typing: manualTyping() });
    await page.getByTestId('catalog-query').fill('boy in the bubble');
    await userEvent.keyboard('{Enter}');

    await page
      .getByRole('button', { name: /The Boy in the Bubble/ })
      .first()
      .click();

    await expect.element(page.getByRole('button', { name: 'Request this track' })).toBeVisible();
    expect(catalog.editions).not.toHaveBeenCalled();
    expect(catalog.discography).not.toHaveBeenCalled();
  });

  it('reports a detail it could not read, rather than an empty one', async () => {
    const catalog = catalogStub({
      editions: vi.fn(() =>
        Promise.resolve({ ok: false as const, message: 'The catalog could not be reached.' }),
      ),
    });
    await render(RequestSearch, { catalog, typing: manualTyping() });
    await page.getByTestId('catalog-query').fill('graceland');
    await userEvent.keyboard('{Enter}');
    await page
      .getByRole('button', { name: /Graceland/ })
      .first()
      .click();

    await expect.element(page.getByTestId('detail-error')).toBeVisible();
  });

  it('reports an artist whose releases could not be read', async () => {
    const catalog = catalogStub({
      search: vi.fn(() =>
        Promise.resolve({
          ok: true as const,
          value: {
            ...RESULTS,
            leading: 'artist' as const,
            releaseGroups: [],
            artists: [ARTIST_HIT],
          },
        }),
      ),
      discography: vi.fn(() =>
        Promise.resolve({ ok: false as const, message: 'The catalog could not be reached.' }),
      ),
    });
    await render(RequestSearch, { catalog, typing: manualTyping() });
    await page.getByTestId('catalog-query').fill('paul simon');
    await userEvent.keyboard('{Enter}');

    await page
      .getByRole('button', { name: /Paul Simon/ })
      .first()
      .click();

    await expect.element(page.getByTestId('browse-error')).toBeVisible();
  });

  it('goes to the track a pasted track identifier names', async () => {
    const catalog = catalogStub({
      lookup: vi.fn(() =>
        Promise.resolve({
          ok: true as const,
          value: { kind: 'recording' as const, recording: TRACK_HIT },
        }),
      ),
    });
    await render(RequestSearch, { catalog, typing: manualTyping() });

    await page.getByTestId('catalog-query').fill(RG);
    await userEvent.keyboard('{Enter}');

    await expect.element(page.getByText('The Boy in the Bubble')).toBeVisible();
  });

  it('offers the way out of an empty filtered view, and takes it', async () => {
    const catalog = catalogStub({
      search: vi.fn(() =>
        Promise.resolve({
          ok: true as const,
          value: { ...RESULTS, artists: [ARTIST_HIT] },
        }),
      ),
    });
    await render(RequestSearch, { catalog, typing: manualTyping() });
    await page.getByTestId('catalog-query').fill('graceland');
    await userEvent.keyboard('{Enter}');
    await page.getByRole('button', { name: 'Tracks' }).click();
    await expect.element(page.getByTestId('no-matches')).toBeVisible();

    await page.getByRole('button', { name: /album/ }).click();

    await expect.element(page.getByText('Graceland')).toBeVisible();
  });

  it('lets the newest search win when an older one is still in the air', async () => {
    const stalled = Promise.withResolvers<unknown>();
    const catalog = catalogStub({
      search: vi
        .fn()
        .mockImplementationOnce(() => stalled.promise)
        .mockImplementation(() =>
          Promise.resolve({
            ok: true as const,
            value: {
              ...RESULTS,
              releaseGroups: [{ ...RESULTS.releaseGroups[0]!, title: 'Newer' }],
            },
          }),
        ),
    });
    await render(RequestSearch, { catalog, typing: manualTyping() });

    await page.getByTestId('catalog-query').fill('graceland');
    await userEvent.keyboard('{Enter}');
    await page.getByTestId('catalog-query').fill('graceland live');
    await userEvent.keyboard('{Enter}');
    await expect.element(page.getByText('Newer')).toBeVisible();

    // The abandoned search now answers: it must not overwrite the one that replaced it.
    stalled.resolve({
      ok: true,
      value: { ...RESULTS, releaseGroups: [{ ...RESULTS.releaseGroups[0]!, title: 'Stale' }] },
    });

    await expect.element(page.getByText('Newer')).toBeVisible();
    expect(document.body.textContent).not.toContain('Stale');
  });

  it('reads a tracklist when the detail asks for one, and only once', async () => {
    const catalog = catalogStub({
      editions: vi.fn(() =>
        Promise.resolve({
          ok: true as const,
          value: {
            groups: [
              {
                representative: {
                  mbid: RELEASE,
                  title: 'Graceland',
                  formats: ['CD'],
                  trackCount: 11,
                },
                editions: [{ mbid: RELEASE, title: 'Graceland', formats: ['CD'], trackCount: 11 }],
              },
            ],
            bestMatch: { kind: 'pick' as const, mbid: RELEASE },
          },
        }),
      ),
    });
    await render(RequestSearch, { catalog, typing: manualTyping() });
    await page.getByTestId('catalog-query').fill('graceland');
    await userEvent.keyboard('{Enter}');
    await page
      .getByRole('button', { name: /Graceland/ })
      .first()
      .click();
    await expect.element(page.getByTestId('detail')).toBeVisible();

    const view = page.getByRole('button', { name: 'View tracklist' });
    await view.click();
    await view.click();

    expect(catalog.tracklist).toHaveBeenCalledTimes(1);
    expect(catalog.tracklist).toHaveBeenCalledWith(RELEASE);
  });

  it('carries a chosen pressing into the request the page would submit', async () => {
    const catalog = catalogStub({
      editions: vi.fn(() =>
        Promise.resolve({
          ok: true as const,
          value: {
            groups: [
              {
                representative: {
                  mbid: RELEASE,
                  title: 'Graceland',
                  formats: ['CD'],
                  trackCount: 11,
                  country: 'DE',
                },
                editions: [
                  {
                    mbid: RELEASE,
                    title: 'Graceland',
                    formats: ['CD'],
                    trackCount: 11,
                    country: 'DE',
                  },
                ],
              },
            ],
            bestMatch: { kind: 'pick' as const, mbid: RELEASE },
          },
        }),
      ),
    });
    await render(RequestSearch, { catalog, typing: manualTyping() });
    await page.getByTestId('catalog-query').fill('graceland');
    await userEvent.keyboard('{Enter}');
    await page
      .getByRole('button', { name: /Graceland/ })
      .first()
      .click();
    await expect.element(page.getByTestId('detail')).toBeVisible();

    // Scoped to the edition rows: the best-match summary above them says the same thing about the
    // same pressing, which is the point of it — it is not what a person clicks to CHOOSE one.
    document.querySelector<HTMLButtonElement>('.editions .edition')!.click();
    await tick();

    const form = document.querySelector<HTMLFormElement>('.catalog-detail form.request-form')!;
    expect(new FormData(form).get('kind')).toBe('musicbrainz');
    expect(new FormData(form).get('mbid')).toBe(RELEASE);
  });

  it('says something, and stops waiting, when a catalog conversation rejects outright', async () => {
    // Nothing should reject — the client converts every failure to a value — so this is a bug, and
    // a spinner that never stops is the least debuggable way for one to surface.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    onTestFinished(() => consoleError.mockRestore());
    const catalog = catalogStub({
      search: vi.fn(() => Promise.reject(new Error('a bug, not an outage'))),
    });
    await render(RequestSearch, { catalog, typing: manualTyping() });

    await page.getByTestId('catalog-query').fill('graceland');
    await userEvent.keyboard('{Enter}');

    await expect.element(page.getByTestId('search-error')).toBeVisible();
    expect(document.querySelector('[data-testid="searching"]')).toBeNull();
    expect(consoleError).toHaveBeenCalled();
  });

  it('does not leave a detail view reading forever when its read rejects', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    onTestFinished(() => consoleError.mockRestore());
    const catalog = catalogStub({
      editions: vi.fn(() => Promise.reject(new Error('a bug, not an outage'))),
    });
    await render(RequestSearch, { catalog, typing: manualTyping() });
    await page.getByTestId('catalog-query').fill('graceland');
    await userEvent.keyboard('{Enter}');

    await page
      .getByRole('button', { name: /Graceland/ })
      .first()
      .click();

    await expect.element(page.getByTestId('detail-error')).toBeVisible();
    expect(document.querySelector('[data-testid="detail-loading"]')).toBeNull();
  });

  it('does not wedge a tracklist disclosure when its read rejects', async () => {
    // A tracklist left "loading" is worse than a failed one: a read already in flight is never
    // asked for again, so the spinner would outlive every retry the person makes.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    onTestFinished(() => consoleError.mockRestore());
    const catalog = catalogStub({
      editions: vi.fn(() =>
        Promise.resolve({
          ok: true as const,
          value: {
            groups: [
              {
                representative: {
                  mbid: RELEASE,
                  title: 'Graceland',
                  formats: ['CD'],
                  trackCount: 11,
                },
                editions: [{ mbid: RELEASE, title: 'Graceland', formats: ['CD'], trackCount: 11 }],
              },
            ],
            bestMatch: { kind: 'pick' as const, mbid: RELEASE },
          },
        }),
      ),
      tracklist: vi.fn(() => Promise.reject(new Error('a bug, not an outage'))),
    });
    await render(RequestSearch, { catalog, typing: manualTyping() });
    await page.getByTestId('catalog-query').fill('graceland');
    await userEvent.keyboard('{Enter}');
    await page
      .getByRole('button', { name: /Graceland/ })
      .first()
      .click();
    await expect.element(page.getByTestId('detail')).toBeVisible();

    await page.getByRole('button', { name: 'View tracklist' }).first().click();

    await expect.element(page.getByRole('alert')).toBeVisible();
    expect(document.body.textContent).not.toContain('Reading the tracklist…');
  });

  it('closes the detail when asked, leaving the results behind it', async () => {
    await render(RequestSearch, { catalog: catalogStub(), typing: manualTyping() });
    await page.getByTestId('catalog-query').fill('graceland');
    await userEvent.keyboard('{Enter}');
    await page
      .getByRole('button', { name: /Graceland/ })
      .first()
      .click();
    await expect.element(page.getByTestId('detail')).toBeVisible();

    await page.getByRole('button', { name: 'Close' }).click();

    expect(document.querySelector('[data-testid="detail"]')).toBeNull();
    await expect.element(page.getByText('Graceland')).toBeVisible();
  });

  it('says an identifier names nothing, rather than telling the searcher to paste one', async () => {
    const catalog = catalogStub({
      lookup: vi.fn(() =>
        Promise.resolve({ ok: true as const, value: { kind: 'not-found' as const } }),
      ),
    });
    await render(RequestSearch, { catalog, typing: manualTyping() });

    await page.getByTestId('catalog-query').fill(RG);
    await userEvent.keyboard('{Enter}');

    await expect.element(page.getByTestId('unknown-id')).toBeVisible();
    expect(document.querySelector('[data-testid="no-matches"]')).toBeNull();
  });

  it('searches once for one Enter, not again when the abandoned debounce comes due', async () => {
    const catalog = catalogStub();
    const typing = manualTyping();
    await render(RequestSearch, { catalog, typing });

    await page.getByTestId('catalog-query').fill('graceland');
    await userEvent.keyboard('{Enter}');
    await expect.element(page.getByText('Graceland')).toBeVisible();
    // What the last keystroke scheduled must have been abandoned by pressing Enter.
    typing.settle_();

    expect(catalog.search).toHaveBeenCalledTimes(1);
  });

  it('says it is searching while it waits, and stops saying so once it has answered', async () => {
    const answering = Promise.withResolvers<Awaited<ReturnType<CatalogClient['search']>>>();
    const catalog = catalogStub({ search: vi.fn(() => answering.promise) });
    await render(RequestSearch, { catalog, typing: manualTyping() });

    await page.getByTestId('catalog-query').fill('graceland');
    await userEvent.keyboard('{Enter}');
    await expect.element(page.getByTestId('searching')).toBeVisible();
    expect(document.querySelector('[data-testid="search-hint"]')).toBeNull();

    answering.resolve({ ok: true, value: RESULTS });

    await expect.element(page.getByText('Graceland')).toBeVisible();
    expect(document.querySelector('[data-testid="searching"]')).toBeNull();
  });

  it('forgets a search once the box is emptied, rather than leaving stale results', async () => {
    const typing = manualTyping();
    await render(RequestSearch, { catalog: catalogStub(), typing });
    await page.getByTestId('catalog-query').fill('graceland');
    await userEvent.keyboard('{Enter}');
    await expect.element(page.getByText('Graceland')).toBeVisible();

    await page.getByTestId('catalog-query').fill('');
    typing.settle_();

    await expect.element(page.getByTestId('search-hint')).toBeVisible();
  });

  it('keeps a way to request without JavaScript, which the search itself needs', async () => {
    await render(RequestSearch, { catalog: catalogStub(), typing: manualTyping() });

    await expect.element(page.getByTestId('native-form')).toBeInTheDocument();
    await expect.element(page.getByTestId('native-artist')).toBeInTheDocument();
  });

  it('shows a rejected submission’s message', async () => {
    await render(RequestSearch, {
      catalog: catalogStub(),
      typing: manualTyping(),
      error: 'Invalid input: artist is required',
    });

    await expect.element(page.getByTestId('form-error')).toBeVisible();
  });
});

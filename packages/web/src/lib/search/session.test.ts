import { describe, expect, it, vi } from 'vitest';
import { lookupAsResults, openDetail, readTracklist, runSearch } from './session.js';
import type { CatalogClient } from './client.js';
import type { DetailState, TracklistState } from './detail.js';

const RG = '19847822-1430-3380-9cf1-bc45545b34ac';
const ARTIST = '4d5447d7-c61c-4120-ba1b-d7f471d385b9';
const RECORDING = '0b6b4ba0-d36f-47bd-b4ea-6a5b91842d29';
const RELEASE = '1b022e01-4da6-387b-8658-8678046e4cef';

const RELEASE_GROUP_HIT = {
  mbid: RG,
  title: 'Graceland',
  artistCredit: 'Paul Simon',
  year: 1986,
  primaryType: 'Album',
  secondaryTypes: [],
};
const RESULTS = {
  leading: 'release-group' as const,
  releaseGroups: [RELEASE_GROUP_HIT],
  artists: [],
  recordings: [],
};

function catalog(overrides: Partial<CatalogClient> = {}): CatalogClient {
  return {
    search: vi.fn(() => Promise.resolve({ ok: true as const, value: RESULTS })),
    lookup: vi.fn(() =>
      Promise.resolve({ ok: true as const, value: { kind: 'not-found' as const } }),
    ),
    discography: vi.fn(() => Promise.resolve({ ok: true as const, value: { releaseGroups: [] } })),
    editions: vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        value: { groups: [], bestMatch: { kind: 'selection-required' as const } },
      }),
    ),
    tracklist: vi.fn(() => Promise.resolve({ ok: true as const, value: { tracks: [] } })),
    ...overrides,
  };
}

function hooks() {
  return { onSearching: vi.fn(), onResults: vi.fn(), onFailure: vi.fn() };
}

describe('runSearch', () => {
  it('searches for what was typed and hands back what matched', async () => {
    const client = catalog();
    const spies = hooks();

    await runSearch(client, 'graceland', new AbortController().signal, spies);

    expect(client.search).toHaveBeenCalledWith('graceland', expect.anything());
    expect(spies.onResults).toHaveBeenCalledWith(RESULTS);
    expect(spies.onSearching).toHaveBeenLastCalledWith(false);
  });

  it('looks up a pasted identifier instead of searching for its letters', async () => {
    const client = catalog({
      lookup: vi.fn(() =>
        Promise.resolve({
          ok: true as const,
          value: { kind: 'release-group' as const, releaseGroup: RELEASE_GROUP_HIT },
        }),
      ),
    });
    const spies = hooks();

    await runSearch(client, `  ${RG}  `, new AbortController().signal, spies);

    expect(client.lookup).toHaveBeenCalledWith(RG, expect.anything());
    expect(client.search).not.toHaveBeenCalled();
    expect(spies.onResults).toHaveBeenCalledWith({
      leading: 'release-group',
      releaseGroups: [RELEASE_GROUP_HIT],
      artists: [],
      recordings: [],
    });
  });

  it('reports a catalog that could not answer, and stops saying it is searching', async () => {
    const client = catalog({
      search: vi.fn(() =>
        Promise.resolve({ ok: false as const, message: 'Could not be reached.' }),
      ),
    });
    const spies = hooks();

    await runSearch(client, 'graceland', new AbortController().signal, spies);

    expect(spies.onFailure).toHaveBeenCalledWith('Could not be reached.');
    expect(spies.onResults).not.toHaveBeenCalled();
    expect(spies.onSearching).toHaveBeenLastCalledWith(false);
  });

  it('drops an answer to a search that was abandoned, so the newer one stands', async () => {
    const controller = new AbortController();
    const client = catalog({
      search: vi.fn(() => {
        controller.abort();
        return Promise.resolve({ ok: true as const, value: RESULTS });
      }),
    });
    const spies = hooks();

    await runSearch(client, 'graceland', controller.signal, spies);

    expect(spies.onResults).not.toHaveBeenCalled();
    expect(spies.onFailure).not.toHaveBeenCalled();
  });
});

describe('lookupAsResults', () => {
  it('presents each kind of identifier as the only result of its kind', () => {
    expect(
      lookupAsResults({ kind: 'artist', artist: { mbid: ARTIST, name: 'Paul Simon' } }),
    ).toEqual({
      leading: 'artist',
      releaseGroups: [],
      artists: [{ mbid: ARTIST, name: 'Paul Simon' }],
      recordings: [],
    });
    expect(
      lookupAsResults({
        kind: 'recording',
        recording: { mbid: RECORDING, title: 'The Boy in the Bubble', artistCredit: 'Paul Simon' },
      }).recordings,
    ).toHaveLength(1);
  });

  it('presents an identifier that names nothing as nothing found', () => {
    expect(lookupAsResults({ kind: 'not-found' })).toEqual({
      leading: 'release-group',
      releaseGroups: [],
      artists: [],
      recordings: [],
    });
  });
});

describe('openDetail', () => {
  it('opens a track from what is already in hand, asking the catalog nothing', async () => {
    const client = catalog();
    const opened: DetailState[] = [];

    await openDetail(client, 'recording', RECORDING, 'The Boy in the Bubble', (d) => {
      opened.push(d);
    });

    expect(opened).toEqual([
      { kind: 'recording', mbid: RECORDING, title: 'The Boy in the Bubble' },
    ]);
    expect(client.editions).not.toHaveBeenCalled();
    expect(client.discography).not.toHaveBeenCalled();
  });

  it('reads an album’s editions, saying so while it reads', async () => {
    const client = catalog();
    const opened: DetailState[] = [];

    await openDetail(client, 'release-group', RG, 'Graceland', (d) => {
      opened.push(d);
    });

    expect(opened[0]).toEqual({ kind: 'loading', title: 'Graceland' });
    expect(opened[1]).toMatchObject({ kind: 'release-group', mbid: RG });
  });

  it('reports an album whose editions could not be read', async () => {
    const client = catalog({
      editions: vi.fn(() =>
        Promise.resolve({ ok: false as const, message: 'Could not be reached.' }),
      ),
    });
    const opened: DetailState[] = [];

    await openDetail(client, 'release-group', RG, 'Graceland', (d) => {
      opened.push(d);
    });

    expect(opened.at(-1)).toEqual({
      kind: 'failed',
      title: 'Graceland',
      message: 'Could not be reached.',
    });
  });

  it('reads an artist’s releases', async () => {
    const client = catalog({
      discography: vi.fn(() =>
        Promise.resolve({ ok: true as const, value: { releaseGroups: [RELEASE_GROUP_HIT] } }),
      ),
    });
    const opened: DetailState[] = [];

    await openDetail(client, 'artist', ARTIST, 'Paul Simon', (d) => {
      opened.push(d);
    });

    expect(opened.at(-1)).toMatchObject({ kind: 'artist', mbid: ARTIST });
  });

  it('reports an artist whose releases could not be read', async () => {
    const client = catalog({
      discography: vi.fn(() =>
        Promise.resolve({ ok: false as const, message: 'Could not be reached.' }),
      ),
    });
    const opened: DetailState[] = [];

    await openDetail(client, 'artist', ARTIST, 'Paul Simon', (d) => {
      opened.push(d);
    });

    expect(opened.at(-1)).toMatchObject({ kind: 'failed', message: 'Could not be reached.' });
  });
});

describe('readTracklist', () => {
  it('says it is reading, then hands back the running order', async () => {
    const client = catalog({
      tracklist: vi.fn(() =>
        Promise.resolve({
          ok: true as const,
          value: { tracks: [{ position: 1, title: 'Graceland', durationMs: 290_000 }] },
        }),
      ),
    });
    const states: Record<string, TracklistState>[] = [];

    await readTracklist(client, RELEASE, {}, (t) => {
      states.push(t);
    });

    expect(states[0]?.[RELEASE]).toEqual({ kind: 'loading' });
    expect(states.at(-1)?.[RELEASE]).toMatchObject({ kind: 'loaded' });
  });

  it('reports a running order the catalog would not give', async () => {
    const client = catalog({
      tracklist: vi.fn(() =>
        Promise.resolve({ ok: false as const, message: 'Could not be reached.' }),
      ),
    });
    const states: Record<string, TracklistState>[] = [];

    await readTracklist(client, RELEASE, {}, (t) => {
      states.push(t);
    });

    expect(states.at(-1)?.[RELEASE]).toEqual({ kind: 'failed', message: 'Could not be reached.' });
  });

  it('does not read a running order it already has', async () => {
    const client = catalog();
    const onTracklists = vi.fn();

    await readTracklist(client, RELEASE, { [RELEASE]: { kind: 'loading' } }, onTracklists);

    expect(client.tracklist).not.toHaveBeenCalled();
    expect(onTracklists).not.toHaveBeenCalled();
  });
});

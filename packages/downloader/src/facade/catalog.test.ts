import { describe, expect, it } from 'vitest';
import {
  CATALOG_EDITIONS,
  CATALOG_RELEASE_GROUP,
  CATALOG_RESULTS,
  UNREACHABLE_CATALOG_FAULT,
  fakeCatalog,
} from '../application/__fixtures__/catalog.js';
import { STORY } from '../application/__fixtures__/correlation.js';
import { catalogSearchWiring } from './__fixtures__/wiring.js';
import {
  catalogEditionsResultSchema,
  catalogLookupResultSchema,
  catalogSearchResultSchema,
  catalogTracklistResultSchema,
} from './index.js';
import type { CatalogSearchPort } from '../application/ports/catalog-search-port.js';

const RG_ID = '19847822-1430-3380-9cf1-bc45545b34ac';
const RELEASE_ID = '1b022e01-4da6-387b-8658-8678046e4cef';

const facadeWith = (catalog: CatalogSearchPort) => catalogSearchWiring(catalog).facade;

/** Every wire answer must survive the trip a real caller puts it through. */
function roundTrip(value: unknown): unknown {
  // The JSON round-trip IS the assertion: it proves the DTO survives wire serialization, which
  // structuredClone (a structured, non-JSON clone) would not exercise.
  // eslint-disable-next-line unicorn/prefer-structured-clone
  return JSON.parse(JSON.stringify(value));
}

describe('searchCatalog', () => {
  it('answers a query with the three kinds of hit and which kind leads', async () => {
    const result = await facadeWith(fakeCatalog()).searchCatalog({ query: 'graceland' }, STORY);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(catalogSearchResultSchema.safeParse(roundTrip(result.value)).success).toBe(true);
    expect(result.value.leading).toBe('release-group');
    expect(result.value.releaseGroups[0]).toMatchObject({
      mbid: RG_ID,
      title: 'Graceland',
      artistCredit: 'Paul Simon',
      year: 1986,
      primaryType: 'Album',
      secondaryTypes: [],
    });
    expect(result.value.recordings[0]?.release).toEqual({ mbid: RELEASE_ID, title: 'Graceland' });
  });

  it('refuses a request that carries no query, rather than searching for nothing', async () => {
    const result = await facadeWith(fakeCatalog()).searchCatalog({}, STORY);

    expect(result).toMatchObject({ ok: false, error: { kind: 'ValidationFailed' } });
  });

  it('reports an unreachable catalog as a fault, not as an empty result', async () => {
    const result = await facadeWith(
      fakeCatalog({ fault: UNREACHABLE_CATALOG_FAULT }),
    ).searchCatalog({ query: 'graceland' }, STORY);

    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'InfraError', operation: 'musicbrainz.catalog.search' },
    });
  });

  it('answers a query that matches nothing with empty lists, which is not a fault', async () => {
    const empty = fakeCatalog({
      results: { releaseGroups: [], artists: [], recordings: [], leading: 'release-group' },
    });

    const result = await facadeWith(empty).searchCatalog({ query: 'zzzz' }, STORY);

    expect(result).toMatchObject({
      ok: true,
      value: { releaseGroups: [], artists: [], recordings: [] },
    });
  });
});

describe('lookupCatalog', () => {
  it('resolves an identifier to the kind of thing it names', async () => {
    const result = await facadeWith(fakeCatalog()).lookupCatalog({ mbid: RG_ID }, STORY);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(catalogLookupResultSchema.safeParse(roundTrip(result.value)).success).toBe(true);
    expect(result.value).toMatchObject({
      kind: 'release-group',
      releaseGroup: { title: 'Graceland' },
    });
  });

  it('reports an identifier that names nothing as an answer, not a fault', async () => {
    const result = await facadeWith(fakeCatalog({ lookup: { kind: 'notFound' } })).lookupCatalog(
      { mbid: RG_ID },
      STORY,
    );

    expect(result).toMatchObject({ ok: true, value: { kind: 'not-found' } });
  });

  it('resolves an identifier that names a track, carrying the release it sits on', async () => {
    const found = fakeCatalog({
      lookup: {
        kind: 'found',
        entity: { kind: 'recording', recording: CATALOG_RESULTS.recordings[0]! },
      },
    });

    const result = await facadeWith(found).lookupCatalog({ mbid: RG_ID }, STORY);

    expect(result).toMatchObject({
      ok: true,
      value: { kind: 'recording', recording: { title: 'The Boy in the Bubble' } },
    });
    if (!result.ok) return;
    expect(catalogLookupResultSchema.safeParse(roundTrip(result.value)).success).toBe(true);
  });

  it('resolves an identifier that names an artist', async () => {
    const found = fakeCatalog({
      lookup: { kind: 'found', entity: { kind: 'artist', artist: CATALOG_RESULTS.artists[0]! } },
    });

    const result = await facadeWith(found).lookupCatalog({ mbid: RG_ID }, STORY);

    expect(result).toMatchObject({
      ok: true,
      value: { kind: 'artist', artist: { name: 'Paul Simon' } },
    });
    if (!result.ok) return;
    expect(catalogLookupResultSchema.safeParse(roundTrip(result.value)).success).toBe(true);
  });

  it('carries a track that sits on no release, without inventing one', async () => {
    const found = fakeCatalog({
      lookup: {
        kind: 'found',
        entity: {
          kind: 'recording',
          recording: { ...CATALOG_RESULTS.recordings[0]!, release: undefined },
        },
      },
    });

    const result = await facadeWith(found).lookupCatalog({ mbid: RG_ID }, STORY);

    expect(result).toMatchObject({ ok: true, value: { kind: 'recording' } });
    if (!result.ok) return;
    expect(result.value.recording?.release).toBeUndefined();
  });
});

describe('the lookup answer’s wire shape', () => {
  const ARTIST = { mbid: RG_ID, name: 'Paul Simon' };

  it.each([['release-group'], ['artist'], ['recording']])(
    'refuses a %s answer whose payload never arrived',
    (kind) => {
      // The tag is what a reader branches on, so a tag without its payload would send a reader
      // down a branch and hand it nothing — a page rendering an empty record as a real one.
      expect(catalogLookupResultSchema.safeParse({ kind }).success).toBe(false);
    },
  );

  it('refuses an answer carrying a payload its tag did not name', () => {
    // A reader that fills its blocks from whichever fields are present — which is how a lookup is
    // rendered through the search surface — would show an Albums block under an artist lookup.
    expect(
      catalogLookupResultSchema.safeParse({
        kind: 'artist',
        artist: ARTIST,
        releaseGroup: {
          mbid: RG_ID,
          title: 'Graceland',
          artistCredit: 'Paul Simon',
          secondaryTypes: [],
        },
      }).success,
    ).toBe(false);
  });

  it('refuses an answer that found nothing but carries something anyway', () => {
    expect(catalogLookupResultSchema.safeParse({ kind: 'not-found', artist: ARTIST }).success).toBe(
      false,
    );
  });
});

describe('the identifier every catalog read takes', () => {
  it.each([['lookupCatalog'], ['browseArtist'], ['listEditions'], ['getTracklist']])(
    'refuses %s an identifier that is not a catalog id',
    async (verb) => {
      const facade = facadeWith(fakeCatalog());

      const result = await facade[verb as 'lookupCatalog']({ mbid: 'not-an-mbid' }, STORY);

      expect(result).toMatchObject({ ok: false, error: { kind: 'ValidationFailed' } });
    },
  );

  it.each([['lookupCatalog'], ['browseArtist'], ['listEditions'], ['getTracklist']])(
    'refuses %s a request that names no identifier at all',
    async (verb) => {
      const facade = facadeWith(fakeCatalog());

      const result = await facade[verb as 'lookupCatalog']({}, STORY);

      expect(result).toMatchObject({ ok: false, error: { kind: 'ValidationFailed' } });
    },
  );

  it.each([['lookupCatalog'], ['browseArtist'], ['listEditions']])(
    'reports an unreachable catalog from %s as a fault',
    async (verb) => {
      const facade = facadeWith(fakeCatalog({ fault: UNREACHABLE_CATALOG_FAULT }));

      const result = await facade[verb as 'lookupCatalog']({ mbid: RG_ID }, STORY);

      expect(result).toMatchObject({ ok: false, error: { kind: 'InfraError' } });
    },
  );
});

describe('browseArtist', () => {
  it('reads an artist’s body of work', async () => {
    const result = await facadeWith(fakeCatalog()).browseArtist({ mbid: RG_ID }, STORY);

    expect(result).toMatchObject({
      ok: true,
      value: { releaseGroups: [{ title: CATALOG_RELEASE_GROUP.title }] },
    });
  });
});

describe('listEditions', () => {
  it('reads editions grouped by tracklist, naming the pipeline’s own default', async () => {
    const result = await facadeWith(fakeCatalog()).listEditions({ mbid: RG_ID }, STORY);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(catalogEditionsResultSchema.safeParse(roundTrip(result.value)).success).toBe(true);
    expect(result.value.groups[0]?.representative.trackCount).toBe(
      CATALOG_EDITIONS.groups[0]?.representative.trackCount,
    );
    expect(result.value.bestMatch).toEqual({ kind: 'pick', mbid: RELEASE_ID });
  });

  it('says selection is required when the pipeline would not pick for itself', async () => {
    const catalog = fakeCatalog({
      editions: { groups: [], bestMatch: { kind: 'selectionRequired' } },
    });

    const result = await facadeWith(catalog).listEditions({ mbid: RG_ID }, STORY);

    expect(result).toMatchObject({
      ok: true,
      value: { bestMatch: { kind: 'selection-required' } },
    });
  });
});

describe('getTracklist', () => {
  it('reads one edition’s running order', async () => {
    const result = await facadeWith(fakeCatalog()).getTracklist({ mbid: RELEASE_ID }, STORY);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(catalogTracklistResultSchema.safeParse(roundTrip(result.value)).success).toBe(true);
    expect(result.value.tracks).toEqual([
      { position: 1, title: 'The Boy in the Bubble', durationMs: 239_000 },
    ]);
  });

  it('reports an unreachable catalog while reading a tracklist as a fault', async () => {
    const result = await facadeWith(fakeCatalog({ fault: UNREACHABLE_CATALOG_FAULT })).getTracklist(
      { mbid: RELEASE_ID },
      STORY,
    );

    expect(result).toMatchObject({ ok: false, error: { kind: 'InfraError' } });
  });
});

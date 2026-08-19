import { describe, expect, it } from 'vitest';
import {
  CATALOG_RELEASE_GROUP,
  CATALOG_RESULTS,
  UNREACHABLE_CATALOG_FAULT,
  fakeCatalog,
} from '../application/__fixtures__/catalog.js';
import { STORY } from '../application/__fixtures__/correlation.js';
import { createLogger } from '../application/logging/logger.js';
import { catalogSearchWiring } from './__fixtures__/wiring.js';
import {
  catalogEditionsResultSchema,
  catalogLookupResultSchema,
  catalogSearchResultSchema,
  catalogTracklistResultSchema,
  downloaderFacadeErrorSchema,
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

  it('carries what kind of act an artist is all the way onto the wire', async () => {
    const result = await facadeWith(fakeCatalog()).searchCatalog({ query: 'paul simon' }, STORY);

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Through the schema, not just off the port: the DTO strips what it does not declare, so a
      // projection that forgot this field would drop it silently on its way to a browser.
      const onTheWire = catalogSearchResultSchema.parse(roundTrip(result.value));
      expect(onTheWire.artists[0]?.type).toBe('Person');
    }
  });

  it('says whether a fault is worth retrying, so a reader need not guess', async () => {
    // Reached-or-drifted is decided by the adapter that failed, and it is the difference between
    // "try again in a moment" and "this will never work until we fix it". Dropping it at the
    // facade left every consumer to invent an answer.
    const unreachable = await facadeWith(
      fakeCatalog({ fault: UNREACHABLE_CATALOG_FAULT }),
    ).searchCatalog({ query: 'graceland' }, STORY);

    expect(unreachable).toMatchObject({ ok: false, error: { kind: 'InfraError' } });
    if (!unreachable.ok && unreachable.error.kind === 'InfraError') {
      expect(unreachable.error.reason).toBe('unreachable');
    }
  });

  it('names a drifted catalog unreadable all the way to the wire', async () => {
    const drifted = {
      kind: 'InfraError' as const,
      operation: 'musicbrainz.catalog.search',
      message: 'the catalog’s shape has drifted',
      permanent: true,
    };

    const result = await facadeWith(fakeCatalog({ fault: drifted })).searchCatalog(
      { query: 'graceland' },
      STORY,
    );

    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === 'InfraError') {
      expect(result.error.reason).toBe('unreadable');
      // And it survives serialization — this is a value a BFF reads on the other side of a wire.
      expect(downloaderFacadeErrorSchema.parse(roundTrip(result.error))).toEqual(result.error);
    }
  });

  it('answers a query that matches nothing with empty lists, which is not a fault', async () => {
    const empty = fakeCatalog({
      results: {
        releaseGroups: [],
        artists: [],
        recordings: [],
        leading: 'release-group',
        unavailable: [],
      },
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

describe('a search the catalog answered only part of', () => {
  it('carries which kinds could not be read, and why, to the wire', async () => {
    const partial = fakeCatalog({
      results: {
        ...CATALOG_RESULTS,
        unavailable: [{ kind: 'artist' as const, reason: 'unreadable' as const }],
      },
    });

    const result = await facadeWith(partial).searchCatalog({ query: 'graceland' }, STORY);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(catalogSearchResultSchema.safeParse(roundTrip(result.value)).success).toBe(true);
    expect(result.value.unavailable).toEqual([{ kind: 'artist', reason: 'unreadable' }]);
  });
});

describe('a catalog read that faults', () => {
  it('writes down the cause the wire answer cannot carry', async () => {
    // `toFacadeError` drops the zod issues and the fetch error — the wire cannot hold them — so
    // this is the last place that knows WHICH field of the catalog's shape moved.
    const lines: string[] = [];
    const logger = createLogger({
      level: 'warn',
      destination: { write: (line: string) => void lines.push(line) },
    });
    const drifted = {
      kind: 'InfraError' as const,
      operation: 'musicbrainz.catalog.search',
      message: 'the catalog’s shape has drifted',
      permanent: true,
      cause: { issues: [{ path: ['release-groups', 0, 'id'] }] },
    };
    const facade = catalogSearchWiring(fakeCatalog({ fault: drifted }), logger).facade;

    const result = await facade.searchCatalog({ query: 'graceland' }, STORY);

    expect(result.ok).toBe(false);
    expect(lines.join('')).toContain('release-groups');
    expect(JSON.parse(lines[0]!)).toMatchObject({ read: 'search', permanent: true });
  });
});

describe('the editions answer’s wire shape', () => {
  const edition = { mbid: RELEASE_ID, title: 'Graceland', formats: [], trackCount: 11 };

  it('refuses a group that does not contain the edition it is read from', () => {
    // The heading is the representative's tracklist and the list beneath it is `editions`; a group
    // that does not contain its own representative renders as "11 tracks · 0 editions".
    expect(
      catalogEditionsResultSchema.safeParse({
        groups: [{ representative: edition, editions: [] }],
        bestMatch: { kind: 'selection-required' },
      }).success,
    ).toBe(false);
  });

  it('refuses a pick that names an edition the listing does not contain', () => {
    // Such a pick renders NEITHER the badge nor the "no default" notice — the surface would say
    // nothing at all about what the pipeline would do, which is what it exists to preview.
    expect(
      catalogEditionsResultSchema.safeParse({
        groups: [{ representative: edition, editions: [edition] }],
        bestMatch: { kind: 'pick', mbid: '271faeb3-fdd1-3ebb-80aa-97b3116e9341' },
      }).success,
    ).toBe(false);
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
    expect(result.value.groups[0]?.representative.trackCount).toBe(11);
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

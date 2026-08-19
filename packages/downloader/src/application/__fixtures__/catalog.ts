import { errAsync, okAsync } from 'neverthrow';
import { asMbid } from '../../domain/shared/__fixtures__/mbid.js';
import { infraError } from '../ports/errors.js';
import type { InfraError } from '../ports/errors.js';
import type {
  CatalogEditionListing,
  CatalogLookup,
  CatalogReleaseGroup,
  CatalogSearchPort,
  CatalogSearchResults,
  CatalogTrack,
} from '../ports/catalog-search-port.js';

/**
 * A working in-memory catalog for interface tests — a fake, not a mock: it answers with canned
 * catalog data so tests assert on what a caller observes rather than on which calls were made.
 * Every read can be overridden with a fault to exercise the error channel.
 */

export const CATALOG_RELEASE_GROUP: CatalogReleaseGroup = {
  mbid: asMbid('19847822-1430-3380-9cf1-bc45545b34ac'),
  title: 'Graceland',
  artistCredit: 'Paul Simon',
  year: 1986,
  primaryType: 'Album',
  secondaryTypes: [],
};

export const CATALOG_RESULTS: CatalogSearchResults = {
  releaseGroups: [CATALOG_RELEASE_GROUP],
  artists: [
    {
      mbid: asMbid('4d5447d7-c61c-4120-ba1b-d7f471d385b9'),
      name: 'Paul Simon',
      disambiguation: 'US singer',
    },
  ],
  recordings: [
    {
      mbid: asMbid('0b6b4ba0-d36f-47bd-b4ea-6a5b91842d29'),
      title: 'The Boy in the Bubble',
      artistCredit: 'Paul Simon',
      release: { mbid: asMbid('1b022e01-4da6-387b-8658-8678046e4cef'), title: 'Graceland' },
    },
  ],
  leading: 'release-group',
  unavailable: [],
};

const GRACELAND_EDITION = {
  mbid: asMbid('1b022e01-4da6-387b-8658-8678046e4cef'),
  title: 'Graceland',
  disambiguation: undefined,
  date: '1986-08-29',
  country: 'DE',
  formats: ['CD'],
  status: 'Official',
  trackCount: 11,
};

export const CATALOG_EDITIONS: CatalogEditionListing = {
  groups: [
    {
      representative: GRACELAND_EDITION,
      editions: [
        {
          mbid: asMbid('1b022e01-4da6-387b-8658-8678046e4cef'),
          title: 'Graceland',
          disambiguation: undefined,
          date: '1986-08-29',
          country: 'DE',
          formats: ['CD'],
          status: 'Official',
          trackCount: 11,
        },
      ],
    },
  ],
  bestMatch: { kind: 'pick', mbid: asMbid('1b022e01-4da6-387b-8658-8678046e4cef') },
};

export const CATALOG_TRACKS: readonly CatalogTrack[] = [
  { position: 1, title: 'The Boy in the Bubble', durationMs: 239_000 },
];

export interface FakeCatalogOverrides {
  readonly results?: CatalogSearchResults;
  readonly lookup?: CatalogLookup;
  readonly discography?: readonly CatalogReleaseGroup[];
  readonly editions?: CatalogEditionListing;
  readonly tracks?: readonly CatalogTrack[];
  /** When set, every read fails with this fault instead of answering. */
  readonly fault?: InfraError;
}

export function fakeCatalog(overrides: FakeCatalogOverrides = {}): CatalogSearchPort {
  const fault = overrides.fault;
  const answer = <T>(value: T) =>
    fault === undefined ? okAsync<T, InfraError>(value) : errAsync<T, InfraError>(fault);
  return {
    search: () => answer(overrides.results ?? CATALOG_RESULTS),
    lookup: () =>
      answer(
        overrides.lookup ?? {
          kind: 'found',
          entity: { kind: 'release-group', releaseGroup: CATALOG_RELEASE_GROUP },
        },
      ),
    discography: () => answer(overrides.discography ?? [CATALOG_RELEASE_GROUP]),
    editions: () => answer(overrides.editions ?? CATALOG_EDITIONS),
    tracklist: () => answer(overrides.tracks ?? CATALOG_TRACKS),
  };
}

/** A catalog that is unreachable, for the paths that must report a fault rather than emptiness. */
export const UNREACHABLE_CATALOG_FAULT = infraError(
  'musicbrainz.catalog.search',
  'the catalog could not be reached',
);

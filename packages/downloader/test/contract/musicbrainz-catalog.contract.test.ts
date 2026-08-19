import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { testScope } from '../../src/application/__fixtures__/correlation.js';
import { MusicBrainzCatalogSearch } from '../../src/adapters/musicbrainz/catalog-search.js';
import { parseMbid } from '../../src/domain/shared/mbid.js';
import { loadFixtures } from './support/fixture.js';
import { startFixtureServer } from './support/server.js';
import type { ContractFixture } from './support/fixture.js';
import type { FixtureServer } from './support/server.js';
import type { Mbid } from '../../src/domain/shared/mbid.js';
import type { InfraError } from '../../src/application/ports/errors.js';
import type { ResultAsync } from 'neverthrow';

/**
 * Tier 1 for the catalog-search adapter: the real {@link MusicBrainzCatalogSearch}, over real
 * `fetch`, answering from a local server that serves bytes recorded from the live service. It
 * asserts both that the adapter consumes contract-conforming responses correctly and that the
 * requests it sends — path, query, identification headers — match what was recorded.
 *
 * The recorded release-group search is also the standing evidence for why ranking exists: in those
 * bytes MusicBrainz scores a marimba tribute 100 and Graceland itself 49, because the tribute's
 * TITLE contains every query token. If ranking ever regresses to trusting that order, this tier
 * fails against real provider data rather than against a hand-written stub.
 */

const USER_AGENT = 'music-downloader-contract-test/0.0';
const ALBUM_QUERY = 'paul simon graceland';
const ARTIST_QUERY = 'paul simon';
const TRACK_QUERY = 'paul simon the boy in the bubble';

const fixtures = loadFixtures('musicbrainz');
const byName = (name: string): ContractFixture => {
  const hit = fixtures.find((candidate) => candidate.name === name);
  if (hit === undefined) throw new Error(`missing fixture ${name}`);
  return hit.fixture;
};

/** Ids fed back into the adapter come from the recorded bytes, so they go through the parser. */
const recordedMbid = (value: string): Mbid => parseMbid(value)._unsafeUnwrap();
const mbidFromPath = (name: string): Mbid =>
  recordedMbid(byName(name).request.path.split('/').at(-1)!);

let server: FixtureServer;

/** Await a catalog read and take its value — every read in this tier is expected to succeed. */
async function unwrap<T>(pending: ResultAsync<T, InfraError>): Promise<T> {
  const result = await pending;
  return result._unsafeUnwrap();
}

function adapter(): MusicBrainzCatalogSearch {
  return new MusicBrainzCatalogSearch(undefined, {
    baseUrl: server.baseUrl,
    userAgent: USER_AGENT,
  });
}

beforeEach(async () => {
  server = await startFixtureServer(fixtures);
});
afterEach(async () => {
  await server.close();
});

describe('MusicBrainz catalog-search contract (tier 1)', () => {
  it('ranks the record above the tribute, against the provider’s own contrary scoring', async () => {
    const results = await unwrap(adapter().search(ALBUM_QUERY, testScope()));

    const [first] = results.releaseGroups;
    expect(first?.title).toBe('Graceland');
    expect(first?.artistCredit).toBe('Paul Simon');
    // What the provider actually put first in the recorded bytes:
    expect(results.releaseGroups.map((group) => group.title)).toContain(
      "Paul Simon's Graceland: Solo Marimba",
    );
    expect(results.leading).toBe('release-group');
  });

  it('sends the recorded search paths, queries, and identification headers', async () => {
    await adapter().search(ALBUM_QUERY, testScope());

    const sent = server.requests.find((request) => request.path === '/release-group')!;
    expect(sent.method).toBe('GET');
    expect(sent.query).toEqual(byName('catalog-release-group-search.json').request.query);
    expect(sent.headers['user-agent']).toBe(USER_AGENT);
    expect(sent.headers.accept).toBe('application/json');
  });

  it('leads with the artist when the query is exactly their name', async () => {
    const results = await unwrap(adapter().search(ARTIST_QUERY, testScope()));

    expect(results.leading).toBe('artist');
    expect(results.artists[0]?.name).toBe('Paul Simon');
  });

  it('leads with tracks when the query names one, and carries the release it sits on', async () => {
    const results = await unwrap(adapter().search(TRACK_QUERY, testScope()));

    expect(results.leading).toBe('recording');
    expect(results.recordings[0]?.title.toLowerCase()).toContain('boy in the bubble');
    expect(results.recordings[0]?.release?.mbid).toBeDefined();
  });

  it('resolves a pasted release-group identifier from the recorded lookup', async () => {
    const mbid = mbidFromPath('catalog-release-group-lookup.json');

    const found = await unwrap(adapter().lookup(mbid, testScope()));

    expect(found).toMatchObject({ kind: 'found', entity: { kind: 'release-group' } });
    const sent = server.requests.find((request) => request.path === `/release-group/${mbid}`)!;
    expect(sent.query).toEqual(byName('catalog-release-group-lookup.json').request.query);
  });

  it('resolves a pasted artist identifier, having found no release group under it', async () => {
    const mbid = mbidFromPath('catalog-artist-lookup.json');

    const found = await unwrap(adapter().lookup(mbid, testScope()));

    expect(found).toMatchObject({ kind: 'found', entity: { kind: 'artist' } });
  });

  it('resolves a pasted recording identifier', async () => {
    const mbid = mbidFromPath('catalog-recording-lookup.json');

    const found = await unwrap(adapter().lookup(mbid, testScope()));

    expect(found).toMatchObject({ kind: 'found', entity: { kind: 'recording' } });
  });

  it('browses an artist’s work from the recorded browse, albums first', async () => {
    const artist = mbidFromPath('catalog-artist-lookup.json');

    const work = await unwrap(adapter().discography(artist, testScope()));

    expect(work.length).toBeGreaterThan(0);
    const firstNonAlbum = work.findIndex((group) => group.primaryType !== 'Album');
    const lastAlbum = work.map((group) => group.primaryType).lastIndexOf('Album');
    if (firstNonAlbum !== -1) expect(lastAlbum).toBeLessThan(firstNonAlbum);
    const sent = server.requests.find((request) => request.path === '/release-group')!;
    expect(sent.query).toEqual(byName('catalog-artist-browse.json').request.query);
  });

  it('reads one edition’s running order from the recorded lookup', async () => {
    const release = mbidFromPath('catalog-tracklist.json');

    const tracks = await unwrap(adapter().tracklist(release, testScope()));

    expect(tracks.length).toBeGreaterThan(0);
    expect(typeof tracks[0]?.position).toBe('number');
    expect(typeof tracks[0]?.title).toBe('string');
    const sent = server.requests.find((request) => request.path === `/release/${release}`)!;
    expect(sent.query).toEqual(byName('catalog-tracklist.json').request.query);
  });

  it('groups a release group’s editions by tracklist and names the pipeline’s own pick', async () => {
    // Reuses the release-group browse the resolution tier records — the same URL the editions read
    // builds, so one recording serves both consumers.
    const releaseGroup = recordedMbid(
      byName('release-group-browse.json').request.query!['release-group']!,
    );

    const listing = await unwrap(adapter().editions(releaseGroup, testScope()));

    expect(listing.groups.length).toBeGreaterThan(0);
    expect(listing.bestMatch.kind).toBe('pick');
    const grouped = listing.groups.flatMap((group) =>
      group.editions.map((edition) => edition.trackCount),
    );
    expect(new Set(grouped).size).toBeLessThanOrEqual(listing.groups.length);
  });
});

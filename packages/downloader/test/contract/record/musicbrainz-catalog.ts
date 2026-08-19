import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  mbArtistSearchSchema,
  mbCatalogRecordingSearchSchema,
  mbReleaseGroupSearchSchema,
} from '../../../src/adapters/musicbrainz/schemas.js';
import { CONTRACT_FIXTURE_ROOT } from '../support/fixture.js';
import type { ContractFixture } from '../support/fixture.js';

/**
 * Records the MusicBrainz contract fixtures for the catalog-SEARCH path (change:
 * search-first-request-ui) — the read a person formulates a request with, as opposed to the
 * resolution path the sibling recorders capture. Anonymous, ≥1 req/s, descriptive User-Agent per
 * MusicBrainz etiquette; public data, so no sanitization.
 *
 *   pnpm tsx test/contract/record/musicbrainz-catalog.ts
 *
 * Each identifier is taken from the search that precedes it rather than hardcoded, so the recorded
 * set stays internally consistent: the lookups and the browse are of the very things the recorded
 * searches returned.
 */

const BASE_URL = 'https://musicbrainz.org/ws/2';
const USER_AGENT = 'music-downloader-contract/0.0 (https://github.com/anthropics/music-downloader)';
const OUT_DIR = path.join(CONTRACT_FIXTURE_ROOT, 'musicbrainz');

// Graceland: an album with a long, messy edition list and a famous track — the same record the
// ranking specs use, so a reader can compare the recorded bytes against the ranking fixtures.
const ALBUM_QUERY = 'paul simon graceland';
const ARTIST_QUERY = 'paul simon';
const TRACK_QUERY = 'paul simon the boy in the bubble';
/** Mirrors the adapter's own per-entity search limit. */
const SEARCH_LIMIT = 25;
/** A well-formed identifier the catalog holds nothing under — the 404 half of every lookup. */
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';
/** Mirrors the adapter's browse ceiling. */
const BROWSE_LIMIT = 100;

const capturedAt = new Date().toISOString().slice(0, 10);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Fetch with the exact raw query the adapter builds, storing the decoded query a server sees. */
async function get(requestPath: string, rawQuery: string): Promise<ContractFixture> {
  const response = await fetch(`${BASE_URL}${requestPath}?${rawQuery}`, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
  });
  // A 404 carries a body of its own; what matters about it is the status, so it is recorded as
  // the answer it is rather than as a shape anything parses.
  const body: unknown = response.status === 404 ? undefined : await response.json();
  await sleep(1100); // ≥1 req/s
  return {
    provenance: { source: `${BASE_URL} (live)`, capturedAt, note: 'public data; no sanitization' },
    request: {
      method: 'GET',
      path: requestPath,
      query: Object.fromEntries(new URLSearchParams(rawQuery)),
    },
    response: { status: response.status, body },
  };
}

function write(name: string, fixture: ContractFixture): void {
  writeFileSync(path.join(OUT_DIR, name), `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`wrote musicbrainz/${name} (${fixture.response.status})`);
}

function firstId(ids: readonly (string | undefined)[], what: string): string {
  const id = ids.find((candidate) => candidate !== undefined);
  if (id === undefined) throw new Error(`no ${what} in the recorded search`);
  return id;
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });

  // --- the three searches one query fans out into ------------------------------------------------
  const releaseGroups = await get(
    '/release-group',
    `query=${encodeURIComponent(ALBUM_QUERY)}&fmt=json&limit=${SEARCH_LIMIT}`,
  );
  write('catalog-release-group-search.json', releaseGroups);

  const artists = await get(
    '/artist',
    `query=${encodeURIComponent(ARTIST_QUERY)}&fmt=json&limit=${SEARCH_LIMIT}`,
  );
  write('catalog-artist-search.json', artists);

  const recordings = await get(
    '/recording',
    `query=${encodeURIComponent(TRACK_QUERY)}&inc=releases&fmt=json&limit=${SEARCH_LIMIT}`,
  );
  write('catalog-recording-search.json', recordings);

  // --- the lookups the paste-an-identifier path makes --------------------------------------------
  const releaseGroupId = firstId(
    (mbReleaseGroupSearchSchema.parse(releaseGroups.response.body)['release-groups'] ?? []).map(
      (hit) => hit.id,
    ),
    'release group',
  );
  write(
    'catalog-release-group-lookup.json',
    await get(`/release-group/${releaseGroupId}`, 'inc=artist-credits&fmt=json'),
  );

  const artistId = firstId(
    (mbArtistSearchSchema.parse(artists.response.body).artists ?? []).map((hit) => hit.id),
    'artist',
  );
  write('catalog-artist-lookup.json', await get(`/artist/${artistId}`, 'fmt=json'));

  const parsedRecordings =
    mbCatalogRecordingSearchSchema.parse(recordings.response.body).recordings ?? [];
  const recordingId = firstId(
    parsedRecordings.map((hit) => hit.id),
    'recording',
  );
  write(
    'catalog-recording-lookup.json',
    await get(`/recording/${recordingId}`, 'inc=artist-credits+releases&fmt=json'),
  );

  // --- browsing an artist, and reading one edition's running order -------------------------------
  write(
    'catalog-artist-browse.json',
    await get('/release-group', `artist=${artistId}&fmt=json&limit=${BROWSE_LIMIT}`),
  );

  const releaseId = firstId(
    parsedRecordings.flatMap((hit) => (hit.releases ?? []).map((release) => release.id)),
    'release',
  );
  write('catalog-tracklist.json', await get(`/release/${releaseId}`, 'inc=recordings&fmt=json'));

  // --- the answer that drives the whole paste-an-identifier fallthrough --------------------------
  // "No such release group" is what sends a lookup on to the artist and then the recording read,
  // and what a page shows as "that identifier names nothing". A well-formed identifier the catalog
  // holds nothing for captures it without depending on some record staying deleted forever.
  write(
    'catalog-not-found.json',
    await get(`/release-group/${UNKNOWN_ID}`, 'inc=artist-credits&fmt=json'),
  );
}

void main();

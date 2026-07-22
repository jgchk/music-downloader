import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { releaseGroupCandidateIds } from '../../../src/adapters/musicbrainz/mapping.js';
import { mbReleaseGroupBrowseSchema } from '../../../src/adapters/musicbrainz/schemas.js';
import { CONTRACT_FIXTURE_ROOT, type ContractFixture } from '../support/fixture.js';

/**
 * Records the MusicBrainz contract fixtures for the release-group request path (change:
 * request-by-release-group-id). Kept separate from `musicbrainz.ts` so refreshing these does not
 * re-capture the four stable base fixtures. Anonymous, ≥1 req/s, descriptive User-Agent per
 * MusicBrainz etiquette; public data, so no sanitization.
 *
 *   pnpm tsx test/contract/record/musicbrainz-release-group.ts
 *
 * It browses one stable release group's editions (with `inc=media` for track counts), then looks up
 * the representative edition the adapter's picker selects — so tier 1 can replay a full resolution.
 */

const BASE_URL = 'https://musicbrainz.org/ws/2';
const USER_AGENT = 'music-downloader-contract/0.0 (https://github.com/anthropics/music-downloader)';
const OUT_DIR = join(CONTRACT_FIXTURE_ROOT, 'musicbrainz');

// The Dark Side of the Moon — the album whose descriptor/lookup the base recorder also uses.
const RELEASE_GROUP_MBID = 'f5093c06-23e3-404f-aeaa-40f72885ee3a';
const RELEASE_SEARCH_LIMIT = 100;

const capturedAt = new Date().toISOString().slice(0, 10);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Fetch with the exact raw query the adapter builds, storing the decoded query a server sees. */
async function get(path: string, rawQuery: string): Promise<ContractFixture> {
  const response = await fetch(`${BASE_URL}${path}?${rawQuery}`, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
  });
  const body = (await response.json()) as unknown;
  await sleep(1100); // ≥1 req/s
  return {
    provenance: { source: `${BASE_URL} (live)`, capturedAt, note: 'public data; no sanitization' },
    request: { method: 'GET', path, query: Object.fromEntries(new URLSearchParams(rawQuery)) },
    response: { status: response.status, body },
  };
}

function write(name: string, fixture: ContractFixture): void {
  writeFileSync(join(OUT_DIR, name), `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`wrote musicbrainz/${name} (${fixture.response.status})`);
}

// The edition the release-group picker actually selects, so the recorded lookup stays consistent
// with the adapter's selection.
function selectedEditionId(body: unknown): string {
  const releases = mbReleaseGroupBrowseSchema.parse(body).releases;
  const id = releaseGroupCandidateIds(releases)[0];
  if (id === undefined) throw new Error('no official edition in release-group browse');
  return id;
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });

  // Mirror the adapter's browse URL construction verbatim (contract must be byte-faithful).
  const browse = await get(
    '/release',
    `release-group=${encodeURIComponent(RELEASE_GROUP_MBID)}&inc=media&fmt=json&limit=${RELEASE_SEARCH_LIMIT}`,
  );
  write('release-group-browse.json', browse);

  const editionId = selectedEditionId(browse.response.body);
  write(
    'release-group-lookup.json',
    await get(`/release/${editionId}`, 'inc=recordings+artist-credits&fmt=json'),
  );
}

void main();

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  releaseGroupCandidateIds,
  releaseGroupEditionCandidates,
} from '../../../src/adapters/musicbrainz/mapping.js';
import { mbReleaseGroupBrowseSchema } from '../../../src/adapters/musicbrainz/schemas.js';
import { CONTRACT_FIXTURE_ROOT, type ContractFixture } from '../support/fixture.js';

/**
 * Records the MusicBrainz browse fixture for a release group with NO official edition (change:
 * manual-edition-selection) — the case the adapter answers with `needsSelection` instead of
 * resolving. Kept separate from `musicbrainz-release-group.ts` so refreshing this does not
 * re-capture the official-edition fixtures. Anonymous, ≥1 req/s, descriptive User-Agent per
 * MusicBrainz etiquette; public data, so no sanitization.
 *
 *   pnpm tsx test/contract/record/musicbrainz-release-group-no-official.ts
 */

const BASE_URL = 'https://musicbrainz.org/ws/2';
const USER_AGENT = 'music-downloader-contract/0.0 (https://github.com/anthropics/music-downloader)';
const OUT_DIR = join(CONTRACT_FIXTURE_ROOT, 'musicbrainz');

// Great White Wonder — the canonical Bob Dylan bootleg: every edition is non-official, and the
// browse carries the sparse presentation data (null country/format) the candidates must tolerate.
const RELEASE_GROUP_MBID = '03cf7496-f565-3b02-8ffb-1eaaf4aafcf4';
const RELEASE_SEARCH_LIMIT = 100;

const capturedAt = new Date().toISOString().slice(0, 10);

/** Fetch with the exact raw query the adapter builds, storing the decoded query a server sees. */
async function get(path: string, rawQuery: string): Promise<ContractFixture> {
  const response = await fetch(`${BASE_URL}${path}?${rawQuery}`, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
  });
  const body = (await response.json()) as unknown;
  return {
    provenance: { source: `${BASE_URL} (live)`, capturedAt, note: 'public data; no sanitization' },
    request: { method: 'GET', path, query: Object.fromEntries(new URLSearchParams(rawQuery)) },
    response: { status: response.status, body },
  };
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });

  // Mirror the adapter's browse URL construction verbatim (contract must be byte-faithful).
  const browse = await get(
    '/release',
    `release-group=${encodeURIComponent(RELEASE_GROUP_MBID)}&inc=media&fmt=json&limit=${RELEASE_SEARCH_LIMIT}`,
  );

  // Sanity: the recorded group must still have editions but no official one, or the fixture no
  // longer records the case this change exists for.
  const releases = mbReleaseGroupBrowseSchema.parse(browse.response.body).releases;
  if (releaseGroupCandidateIds(releases).length !== 0) {
    throw new Error('release group unexpectedly has an official edition; pick another group');
  }
  if (releaseGroupEditionCandidates(releases).length === 0) {
    throw new Error('release group has no editions at all; pick another group');
  }

  writeFileSync(
    join(OUT_DIR, 'release-group-no-official-browse.json'),
    `${JSON.stringify(browse, null, 2)}\n`,
  );
  console.log(
    `wrote musicbrainz/release-group-no-official-browse.json (${browse.response.status})`,
  );
}

void main();

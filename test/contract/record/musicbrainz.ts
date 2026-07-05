import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTRACT_FIXTURE_ROOT, type ContractFixture } from '../support/fixture.js';

/**
 * Records MusicBrainz contract fixtures from the live JSON web service (task 2.1). Anonymous, spaced
 * at ≥1 req/s with a descriptive User-Agent per MusicBrainz etiquette. It searches for two stable,
 * well-known entities, then looks each up — capturing all four consumed request shapes with real,
 * linked data. MusicBrainz data is public, so no sanitization is required.
 *
 *   pnpm tsx test/contract/record/musicbrainz.ts
 */

const BASE_URL = 'https://musicbrainz.org/ws/2';
const USER_AGENT = 'music-downloader-contract/0.0 (https://github.com/anthropics/music-downloader)';
const OUT_DIR = join(CONTRACT_FIXTURE_ROOT, 'musicbrainz');

// Stable, long-established entities unlikely to be merged or deleted.
const ALBUM = { artist: 'Pink Floyd', title: 'The Dark Side of the Moon' };
const TRACK = { artist: 'Nirvana', title: 'Smells Like Teen Spirit' };

const capturedAt = new Date().toISOString().slice(0, 10);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch with the exact raw query string the adapter builds (so the capture is byte-faithful — the
 * adapter sends `inc=a+b`, i.e. `+`-as-space, not the `%2B` a naive encoder would emit) and store
 * the query in decoded form, matching what a server sees.
 */
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

function topId(body: unknown, key: 'releases' | 'recordings'): string {
  const entries = (body as Record<string, { id?: string }[]>)[key] ?? [];
  const id = entries[0]?.id;
  if (id === undefined) throw new Error(`no ${key} in search result`);
  return id;
}

// Mirror the adapter's own search URL construction verbatim (D: contract must be byte-faithful).
const searchQuery = (q: string): string => `query=${encodeURIComponent(q)}&fmt=json&limit=5`;

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });

  const releaseSearch = await get(
    '/release',
    searchQuery(`release:"${ALBUM.title}" AND artist:"${ALBUM.artist}"`),
  );
  write('release-search.json', releaseSearch);
  const releaseId = topId(releaseSearch.response.body, 'releases');
  write(
    'release-lookup.json',
    await get(`/release/${releaseId}`, 'inc=recordings+artist-credits&fmt=json'),
  );

  const recordingSearch = await get(
    '/recording',
    searchQuery(`recording:"${TRACK.title}" AND artist:"${TRACK.artist}"`),
  );
  write('recording-search.json', recordingSearch);
  const recordingId = topId(recordingSearch.response.body, 'recordings');
  write(
    'recording-lookup.json',
    await get(`/recording/${recordingId}`, 'inc=artist-credits&fmt=json'),
  );
}

void main();

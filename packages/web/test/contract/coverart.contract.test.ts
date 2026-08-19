import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CoverArtArchive } from '../../src/lib/server/cover-art/adapter.js';
import { coverArtManifestSchema } from '../../src/lib/server/cover-art/schemas.js';
import { loadFixtures } from './support/fixture.js';
import { startFixtureServer } from './support/server.js';
import type { FixtureServer } from './support/server.js';

/**
 * The Cover Art Archive tier: the real {@link CoverArtArchive} adapter reading recorded manifests
 * over real HTTP from a local server.
 *
 * Only the manifest is recorded and replayed, because only the manifest has a shape. The image the
 * manifest points at is opaque bytes on a third-party host, so this tier serves those bytes from a
 * stub rather than reaching the network — the boundary between "contract" and "payload" is drawn
 * exactly where the schema stops.
 */

const WITH_ART = '19847822-1430-3380-9cf1-bc45545b34ac';
const RELEASE_WITH_ART = '1eaac429-02a7-48c7-b328-d1247f4d93a4';
const WITHOUT_ART = '00000000-0000-4000-8000-000000000000';
const IMAGE_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

const fixtures = loadFixtures('coverart');
const byName = (name: string) => {
  const hit = fixtures.find((candidate) => candidate.name === name);
  if (hit === undefined) throw new Error(`missing fixture ${name}`);
  return hit.fixture;
};

let server: FixtureServer;

/**
 * Real `fetch` for the archive's own host (the recorded manifest), a canned image for the
 * thumbnail host the manifest names.
 */
function fetchWithStubbedImages(): typeof fetch {
  return (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.startsWith(server.baseUrl)) return fetch(url, init);
    return Promise.resolve(
      new Response(IMAGE_BYTES, { status: 200, headers: { 'Content-Type': 'image/jpeg' } }),
    );
  };
}

beforeEach(async () => {
  server = await startFixtureServer(fixtures);
});
afterEach(async () => {
  await server.close();
});

describe('cover art fixtures', () => {
  it('cover both answers the adapter must tell apart, for both entities it asks about', () => {
    expect(fixtures.map((fixture) => fixture.name).toSorted((a, b) => a.localeCompare(b))).toEqual([
      'release-absent.json',
      'release-front.json',
      'release-group-absent.json',
      'release-group-front.json',
    ]);
  });

  it.each([['release-group-front.json'], ['release-front.json']])(
    '%s conforms to the consumed manifest schema',
    (name) => {
      const manifest = byName(name);
      expect(manifest.response.status).toBe(200);
      expect(coverArtManifestSchema.safeParse(manifest.response.body).success).toBe(true);
    },
  );

  it.each([['release-group-absent.json'], ['release-absent.json']])(
    '%s records the absent answer as the archive gives it: a 404 with nothing to read',
    (name) => {
      const absent = byName(name);
      expect(absent.response.status).toBe(404);
      expect(absent.response.body).toBeUndefined();
    },
  );

  it.each([['release-group-front.json'], ['release-front.json']])(
    '%s carries a front cover with the sizes the request page asks for',
    (name) => {
      const parsed = coverArtManifestSchema.parse(byName(name).response.body);
      const front = (parsed.images ?? []).find((image) => image.front === true);
      expect(front?.thumbnails?.['250']).toBeDefined();
      expect(front?.thumbnails?.['500']).toBeDefined();
    },
  );
});

describe('CoverArtArchive contract (tier 1)', () => {
  // Both entities are replayed because both are asked for in production: an album tile asks by
  // release group, and every track row asks by the release its recording sits on.
  it.each([
    ['release-group' as const, WITH_ART],
    ['release' as const, RELEASE_WITH_ART],
  ])(
    'reads a %s front cover from the recorded manifest, asking the recorded path',
    async (entity, mbid) => {
      const adapter = new CoverArtArchive({ baseUrl: server.baseUrl }, fetchWithStubbedImages());

      const result = await adapter.front(entity, mbid, 250);
      const answer = result._unsafeUnwrap();

      expect(answer).toMatchObject({ kind: 'found', image: { contentType: 'image/jpeg' } });
      const sent = server.requests.find((request) => request.path === `/${entity}/${mbid}`)!;
      expect(sent.method).toBe('GET');
      expect(sent.headers['user-agent']).toContain('music-downloader');
    },
  );

  it.each([['release-group' as const], ['release' as const]])(
    'reads a %s’s recorded 404 as absent, never as a fault',
    async (entity) => {
      const adapter = new CoverArtArchive({ baseUrl: server.baseUrl }, fetchWithStubbedImages());

      const result = await adapter.front(entity, WITHOUT_ART, 250);
      const answer = result._unsafeUnwrap();

      expect(answer).toEqual({ kind: 'absent' });
    },
  );
});

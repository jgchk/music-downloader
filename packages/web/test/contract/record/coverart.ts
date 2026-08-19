import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { coverArtManifestSchema } from '../../../src/lib/server/cover-art/schemas.js';
import { CONTRACT_FIXTURE_ROOT } from '../support/fixture.js';
import type { ContractFixture } from '../support/fixture.js';

/**
 * Records the consumed Cover Art Archive surface (change: search-first-request-ui):
 *
 *   pnpm tsx packages/web/test/contract/record/coverart.ts
 *
 * Only the MANIFEST is recorded, because only the manifest has a shape: the image itself is opaque
 * bytes the adapter passes through without reading, so there is nothing a schema could hold the
 * archive to. Both answers the adapter distinguishes are captured — a record with front art, and
 * one the archive holds nothing for — since the whole capability turns on telling "no art" apart
 * from "archive unreachable".
 *
 * Public data; the manifest is projected to the consumed fields so a recording cannot quietly
 * grow a dependency on a field the adapter never reads.
 */

const BASE = 'https://coverartarchive.org';
const OUT = path.join(CONTRACT_FIXTURE_ROOT, 'coverart');
const TODAY = new Date().toISOString().slice(0, 10);

/** Graceland — the album the ranking fixtures use, and one the archive definitely has art for. */
const WITH_ART = '19847822-1430-3380-9cf1-bc45545b34ac';
/**
 * A well-formed identifier the archive holds nothing for. The 404 is the contract being pinned —
 * "no art" — and the archive answers the same way for an unknown id as for a known one with no
 * images, so a synthetic id captures it without depending on some record staying artless forever.
 */
const WITHOUT_ART = '00000000-0000-4000-8000-000000000000';

async function get(entityPath: string, note: string): Promise<ContractFixture> {
  const response = await fetch(`${BASE}${entityPath}`, { headers: { Accept: 'application/json' } });
  const raw: unknown = response.status === 404 ? undefined : await response.json();
  await sleep(1100);
  // Project to the consumed fields: a recording must not carry what the adapter never reads.
  const parsed = raw === undefined ? undefined : coverArtManifestSchema.parse(raw);
  const body =
    parsed === undefined
      ? undefined
      : {
          images: (parsed.images ?? []).map((image) => ({
            front: image.front,
            image: image.image,
            thumbnails: image.thumbnails,
          })),
        };
  return {
    provenance: { source: `${BASE} (live)`, capturedAt: TODAY, note },
    request: { method: 'GET', path: entityPath },
    response: { status: response.status, body },
  };
}

function write(name: string, fixture: ContractFixture): void {
  writeFileSync(path.join(OUT, name), `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`wrote coverart/${name} (${fixture.response.status})`);
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  write(
    'release-group-front.json',
    await get(`/release-group/${WITH_ART}`, 'public data; projected to consumed fields'),
  );
  write(
    'release-group-absent.json',
    await get(`/release-group/${WITHOUT_ART}`, 'the archive holds no art for this identifier'),
  );
}

void main();

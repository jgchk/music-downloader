import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { PlexTvAccess, isServerResource } from '../../src/lib/server/plex/adapter.js';
import {
  plexPinCreateSchema,
  plexResourcesSchema,
  plexUserSchema,
} from '../../src/lib/server/plex/schemas.js';
import type { PlexResources, PlexUser } from '../../src/lib/server/plex/schemas.js';
import { loadFixtures } from './support/fixture.js';
import type { ContractFixture } from './support/fixture.js';
import { startFixtureServer } from './support/server.js';
import type { FixtureServer } from './support/server.js';

/**
 * Tier 1 for the plex.tv adapter (external-api-contracts): the real {@link PlexTvAccess}, over
 * real `fetch`, runs the whole login conversation against a local server replaying the recorded
 * fixtures. It asserts both that the adapter consumes contract-conforming responses correctly and
 * that the requests it sends — paths, identity headers, token header — match the pairing contract.
 */

const fixtures = loadFixtures('plextv');
const byName = (name: string): ContractFixture => {
  const hit = fixtures.find((f) => f.name === name);
  if (hit === undefined) throw new Error(`missing fixture ${name}`);
  return hit.fixture;
};

const pinIdOf = (name: string): number => Number(byName(name).request.path.split('/').at(-1));

/**
 * A recorded body, read THROUGH the production schema that governs it — the tier asserts against
 * the same consumed surface the adapter parses, and a fixture that drifted out of that shape fails
 * here rather than being asserted against a hand-written claim about its type.
 */
const bodyOf = <Schema extends z.ZodType>(name: string, schema: Schema): z.infer<Schema> =>
  schema.parse(byName(name).response.body);

let server: FixtureServer;

function adapter(machineId: string): PlexTvAccess {
  return new PlexTvAccess({ baseUrl: server.baseUrl, machineId });
}

/**
 * A recorded resource entry, typed from the PRODUCTION schema rather than restated here — one
 * source of truth for the wire shape, so a schema change can never leave this tier asserting
 * against a stale hand-written claim.
 */
type RecordedResource = PlexResources[number];

/**
 * The recorded account, with its username witnessed as a real string first: the schema declares
 * `username` `.nullish()`, so an assertion comparing the adapter's username to an ABSENT recorded
 * one would pass vacuously (`undefined === undefined`) and prove nothing about the membership read.
 */
function recordedUser(): PlexUser {
  const user = bodyOf('user.json', plexUserSchema);
  expect(typeof user.username).toBe('string');
  return user;
}

/** The first recorded (pseudonymized) clientIdentifier — a machine the account provably sees. */
function recordedMachineId(): string {
  return bodyOf('resources.json', plexResourcesSchema)[0]!.clientIdentifier;
}

const recordedResources = (): RecordedResource[] => bodyOf('resources.json', plexResourcesSchema);

/**
 * The recorded entry that declares a server, if the recording has one — asked with the PRODUCTION
 * predicate, so this tier cannot disagree with the adapter about what "is a server" means.
 *
 * A recording captured BEFORE `provides` was consumed cannot witness one: the projection dropped
 * the field. Until the fixture is re-recorded, the grant path is covered at the unit tier
 * (adapter.test.ts) against the tolerant schema, and this tier witnesses what the recording
 * honestly contains: real identifiers, and a fail-closed denial for entries that do not declare a
 * server. Fabricating the field here would defeat the tier's whole point.
 */
function recordedServer(): RecordedResource | undefined {
  return recordedResources().find((entry) => isServerResource(entry.provides));
}

beforeEach(async () => {
  server = await startFixtureServer(fixtures);
});
afterEach(async () => {
  await server.close();
});

describe('plex.tv contract (tier 1)', () => {
  it('creates a PIN with the recorded path, strong query, and identity headers', async () => {
    const result = await adapter('any').createPin();
    const recorded = bodyOf('pin-create.json', plexPinCreateSchema);
    expect(result._unsafeUnwrap()).toEqual({ id: recorded.id, code: recorded.code });

    const [request] = server.requests;
    expect(request!.method).toBe('POST');
    expect(request!.path).toBe('/pins');
    expect(request!.query).toEqual(byName('pin-create.json').request.query);
    expect(request!.headers['x-plex-product']).toBe('music-downloader');
    expect(request!.headers['x-plex-client-identifier']).toBe('music-downloader-web');
    expect(request!.headers.accept).toBe('application/json');
  });

  it('reads an approved PIN check as authorized, sending the same identity headers that created the PIN', async () => {
    const result = await adapter('any').checkPin(pinIdOf('pin-check-authorized.json'));
    expect(result._unsafeUnwrap()).toEqual({
      kind: 'authorized',
      token: 'plex-user-token-scrubbed',
    });
    // Plex's pairing contract: the CHECKING client identifier must match the creating one, or
    // real checks never authorize — so the tier pins the headers here, not just on create.
    const [request] = server.requests;
    expect(request!.headers['x-plex-client-identifier']).toBe('music-downloader-web');
    expect(request!.headers.accept).toBe('application/json');
  });

  it('reads an unapproved PIN check as pending, with the identity headers riding along', async () => {
    const result = await adapter('any').checkPin(pinIdOf('pin-check-pending.json'));
    expect(result._unsafeUnwrap()).toEqual({ kind: 'pending' });
    expect(server.requests[0]!.headers['x-plex-client-identifier']).toBe('music-downloader-web');
  });

  it('reads the recorded 404 for a nonexistent PIN as expired', async () => {
    const result = await adapter('any').checkPin(pinIdOf('pin-check-expired.json'));
    expect(result._unsafeUnwrap()).toEqual({ kind: 'expired' });
  });

  it('runs the membership conversation against the recorded account, sending the token as a header on both calls', async () => {
    const result = await adapter(recordedMachineId()).checkMembership('a-token');
    // The recorded account is witnessable whatever the verdict is — but the two arms carry the
    // username in different places, so read it THROUGH the verdict. (A re-recorded listing that
    // leads with the owner's server turns this outcome into `granted`; assuming the denied shape
    // would fail on exactly the handoff step this tier is waiting for.)
    const outcome = result._unsafeUnwrap();
    const user = recordedUser();
    expect(outcome.kind === 'granted' ? outcome.identity.username : outcome.username).toBe(
      user.username,
    );

    // Both lookups must happen with the token — their relative order is not part of the contract.
    expect(
      server.requests.map((r) => `${r.method} ${r.path}`).toSorted((a, b) => a.localeCompare(b)),
    ).toEqual(['GET /resources', 'GET /user']);
    for (const request of server.requests) {
      expect(request.headers['x-plex-token']).toBe('a-token');
      expect(request.headers['x-plex-client-identifier']).toBe('music-downloader-web');
    }
  });

  it('denies membership for a machine id absent from the recorded resources', async () => {
    const result = await adapter('not-a-recorded-machine').checkMembership('a-token');
    const user = recordedUser();
    expect(result._unsafeUnwrap()).toEqual({
      kind: 'denied',
      username: user.username,
      reason: 'no-machine-match',
    });
  });

  const nonServerEntry = (): RecordedResource | undefined =>
    recordedResources().find((entry) => !isServerResource(entry.provides));

  // Selected by the PREDICATE, never by position: a re-recorded listing where the account sees two
  // servers must not nominate the second one as the "non-server" case.
  it.runIf(nonServerEntry() !== undefined)(
    'denies a recorded identifier whose entry does not declare a server (fail closed on real data)',
    async () => {
      // The predicate's narrowing, witnessed against wire data: an identifier the account provably
      // sees is NOT admission unless that entry declares `provides: server`.
      const result = await adapter(nonServerEntry()!.clientIdentifier).checkMembership('a-token');
      const user = recordedUser();
      expect(result._unsafeUnwrap()).toMatchObject({ kind: 'denied', username: user.username });
    },
  );

  // SKIPPED, not silently green, while the recording predates the provides/owned projection (see
  // the fixture's provenance note): a test report must not claim the grant path was witnessed when
  // it was not. Re-recording (`pnpm tsx packages/web/test/contract/record/plextv.ts`) revives it —
  // and the recorder REFUSES to write a listing with no server entry, so the skip cannot survive.
  it.runIf(recordedServer() !== undefined)(
    'grants — with the role plex.tv reports — for a recorded entry that declares a server',
    async () => {
      const recorded = recordedServer()!;
      const user = recordedUser();
      const result = await adapter(recorded.clientIdentifier).checkMembership('a-token');
      expect(result._unsafeUnwrap()).toEqual({
        kind: 'granted',
        identity: { plexAccountId: String(user.id), username: user.username },
        role: recorded.owned === true ? 'owner' : 'guest',
      });
    },
  );

  it('pins the recording against hand-editing while it declares itself pre-projection', () => {
    // The companion to the skip above: a fixture whose PROVENANCE says it predates the
    // provides/owned projection must carry neither field — someone adding `provides: "server"` by
    // hand to revive the grant test (the fabrication this tier exists to prevent) fails here.
    //
    // Keyed on provenance, NOT on a field census: the recorder preserves per-entry wire absence,
    // so a genuine re-record can legitimately produce a MIXED listing. Provenance is what the
    // recorder rewrites, so this pin retires itself on re-record — delete it once task 4.2 lands.
    const note = byName('resources.json').provenance.note ?? '';
    if (!note.includes('PREDATES')) return;
    for (const entry of recordedResources()) {
      expect(entry.provides).toBeUndefined();
      expect(entry.owned).toBeUndefined();
    }
  });
});

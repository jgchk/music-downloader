import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PlexTvAccess, isServerResource } from '../../src/lib/server/plex/adapter.js';
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
const bodyOf = <T>(name: string): T => byName(name).response.body as T;

let server: FixtureServer;

function adapter(machineId: string): PlexTvAccess {
  return new PlexTvAccess({ baseUrl: server.baseUrl, machineId });
}

type RecordedResource = { clientIdentifier: string; provides?: string; owned?: boolean };

/** The first recorded (pseudonymized) clientIdentifier — a machine the account provably sees. */
function recordedMachineId(): string {
  return bodyOf<RecordedResource[]>('resources.json')[0]!.clientIdentifier;
}

const recordedResources = (): RecordedResource[] => bodyOf<RecordedResource[]>('resources.json');

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
    const recorded = bodyOf<{ id: number; code: string }>('pin-create.json');
    expect(result._unsafeUnwrap()).toEqual({ id: recorded.id, code: recorded.code });

    const [request] = server.requests;
    expect(request!.method).toBe('POST');
    expect(request!.path).toBe('/pins');
    expect(request!.query).toEqual(byName('pin-create.json').request.query);
    expect(request!.headers['x-plex-product']).toBe('music-downloader');
    expect(request!.headers['x-plex-client-identifier']).toBe('music-downloader-web');
    expect(request!.headers['accept']).toBe('application/json');
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
    expect(request!.headers['accept']).toBe('application/json');
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
    // The account identity is witnessable against the recording whatever the verdict is.
    const user = bodyOf<{ username: string }>('user.json');
    expect(result._unsafeUnwrap()).toMatchObject({ username: user.username });

    // Both lookups must happen with the token — their relative order is not part of the contract.
    expect(server.requests.map((r) => `${r.method} ${r.path}`).toSorted()).toEqual([
      'GET /resources',
      'GET /user',
    ]);
    for (const request of server.requests) {
      expect(request.headers['x-plex-token']).toBe('a-token');
      expect(request.headers['x-plex-client-identifier']).toBe('music-downloader-web');
    }
  });

  it('denies membership for a machine id absent from the recorded resources', async () => {
    const result = await adapter('not-a-recorded-machine').checkMembership('a-token');
    const user = bodyOf<{ username: string }>('user.json');
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
      const user = bodyOf<{ username: string }>('user.json');
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
      const user = bodyOf<{ id: number; username: string }>('user.json');
      const result = await adapter(recorded.clientIdentifier).checkMembership('a-token');
      expect(result._unsafeUnwrap()).toEqual({
        kind: 'granted',
        identity: { plexAccountId: String(user.id), username: user.username },
        role: recorded.owned === true ? 'owner' : 'guest',
      });
    },
  );

  it('pins the recording as pre-projection, so a half-updated fixture cannot slip through', () => {
    // The companion to the skip above: while ANY entry lacks `provides`, none may carry it — a
    // partially hand-edited fixture (the fabrication this tier exists to prevent) fails here.
    const resources = recordedResources();
    const withCapabilities = resources.filter((entry) => entry.provides !== undefined);
    expect(withCapabilities.length === 0 || withCapabilities.length === resources.length).toBe(
      true,
    );
  });
});

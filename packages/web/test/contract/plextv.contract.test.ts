import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PlexTvAccess } from '../../src/lib/server/plex/adapter.js';
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

/**
 * The recorded entry that declares a server, if the recording has one. The membership predicate
 * needs `provides: "server"`, and a recording captured BEFORE that field was consumed cannot
 * witness it — the projection dropped it. Until the fixture is re-recorded, the grant path is
 * covered at the unit tier (adapter.test.ts) against the tolerant schema, and this tier witnesses
 * what the recording honestly contains: real identifiers, and a fail-closed denial for entries
 * that do not declare a server. Fabricating the field here would defeat the tier's whole point.
 */
function recordedServer(): RecordedResource | undefined {
  return bodyOf<RecordedResource[]>('resources.json').find((entry) =>
    entry.provides?.split(',').some((capability) => capability.trim().toLowerCase() === 'server'),
  );
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
    await adapter(recordedMachineId()).checkMembership('a-token');

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
    expect(result._unsafeUnwrap()).toEqual({ kind: 'denied', username: user.username });
  });

  it('denies a recorded identifier whose entry does not declare a server (fail closed on real data)', async () => {
    // The predicate's narrowing, witnessed against wire data: an identifier the account provably
    // sees is NOT admission unless that entry declares `provides: server`.
    const nonServer = bodyOf<RecordedResource[]>('resources.json').find(
      (entry) => entry !== recordedServer(),
    );
    const result = await adapter(nonServer!.clientIdentifier).checkMembership('a-token');
    const user = bodyOf<{ username: string }>('user.json');
    expect(result._unsafeUnwrap()).toEqual({ kind: 'denied', username: user.username });
  });

  it('grants — with the role plex.tv reports — for a recorded entry that declares a server', async () => {
    const recorded = recordedServer();
    if (recorded === undefined) {
      // The recording predates the provides/owned projection (see the fixture's provenance note),
      // so it cannot witness a grant. The tier states that out loud rather than fabricating the
      // field; grant and role derivation are covered at the unit tier meanwhile. Re-recording
      // (`pnpm tsx packages/web/test/contract/record/plextv.ts`) makes the assertion below real —
      // the recorder now REFUSES to write a listing with no server entry, so a re-record cannot
      // leave this branch alive.
      expect(
        bodyOf<RecordedResource[]>('resources.json').some((e) => e.provides !== undefined),
      ).toBe(false);
      return;
    }
    const user = bodyOf<{ id: number; username: string }>('user.json');
    const result = await adapter(recorded.clientIdentifier).checkMembership('a-token');
    expect(result._unsafeUnwrap()).toEqual({
      kind: 'granted',
      identity: { plexAccountId: String(user.id), username: user.username },
      role: recorded.owned === true ? 'owner' : 'guest',
    });
  });

  it('has no recorded guest-side variant, by design: a share-guest token is not ours to record', () => {
    // `owned: false` cannot be captured — recording it would mean holding someone else's Plex
    // credential, the exact thing the access design refuses. The tolerant default (absent or
    // false ⇒ guest) is covered at the unit tier instead. This test states the gap so a reader
    // does not mistake its absence for an oversight (the same honesty rule the slskd recorder
    // follows for the events/transfers coupling).
    const guestVariant = bodyOf<RecordedResource[]>('resources.json').find(
      (entry) => entry.owned === false,
    );
    expect(guestVariant).toBeUndefined();
  });
});

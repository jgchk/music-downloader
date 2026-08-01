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

/** The first recorded (pseudonymized) clientIdentifier — a machine the account provably sees. */
function recordedMachineId(): string {
  return bodyOf<{ clientIdentifier: string }[]>('resources.json')[0]!.clientIdentifier;
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

  it('reads an approved PIN check as authorized, handing over the (scrubbed) token', async () => {
    const result = await adapter('any').checkPin(pinIdOf('pin-check-authorized.json'));
    expect(result._unsafeUnwrap()).toEqual({
      kind: 'authorized',
      token: 'plex-user-token-scrubbed',
    });
  });

  it('reads an unapproved PIN check as pending', async () => {
    const result = await adapter('any').checkPin(pinIdOf('pin-check-pending.json'));
    expect(result._unsafeUnwrap()).toEqual({ kind: 'pending' });
  });

  it('reads the recorded 404 for a nonexistent PIN as expired', async () => {
    const result = await adapter('any').checkPin(pinIdOf('pin-check-expired.json'));
    expect(result._unsafeUnwrap()).toEqual({ kind: 'expired' });
  });

  it('grants membership for a recorded resource machine id, sending the token as a header on both calls', async () => {
    const result = await adapter(recordedMachineId()).checkMembership('a-token');
    const user = bodyOf<{ id: number; username: string }>('user.json');
    expect(result._unsafeUnwrap()).toEqual({
      kind: 'granted',
      identity: { plexAccountId: String(user.id), username: user.username },
    });

    expect(server.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      'GET /user',
      'GET /resources',
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
});

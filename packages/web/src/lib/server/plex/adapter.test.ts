import type { ResultAsync } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';
import { PlexTvAccess } from './adapter.js';
import { PLEX_CLIENT_IDENTIFIER, PLEX_PRODUCT } from './identity.js';
import type { PlexUnavailable } from './port.js';

const CONFIG = { baseUrl: 'https://plex.test/api/v2', machineId: 'my-server-machine' };

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function fetchStub(...responses: (Response | Error)[]): typeof fetch & ReturnType<typeof vi.fn> {
  const stub = vi.fn();
  for (const r of responses) {
    if (r instanceof Error) stub.mockRejectedValueOnce(r);
    else stub.mockResolvedValueOnce(r);
  }
  return stub as never;
}

async function unwrap<T>(result: ResultAsync<T, PlexUnavailable>): Promise<T> {
  const settled = await result;
  return settled._unsafeUnwrap();
}

async function unwrapError<T>(result: ResultAsync<T, PlexUnavailable>): Promise<PlexUnavailable> {
  const settled = await result;
  return settled._unsafeUnwrapErr();
}

describe('PlexTvAccess.createPin', () => {
  it('POSTs a strong pin with the identifying headers and returns id + code', async () => {
    const stub = fetchStub(jsonResponse({ id: 123, code: 'abc-code', trusted: false }));
    const pin = await unwrap(new PlexTvAccess(CONFIG, stub).createPin());
    expect(pin).toEqual({ id: 123, code: 'abc-code' });
    expect(stub).toHaveBeenCalledWith('https://plex.test/api/v2/pins?strong=true', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'X-Plex-Product': PLEX_PRODUCT,
        'X-Plex-Client-Identifier': PLEX_CLIENT_IDENTIFIER,
      },
    });
  });

  it('surfaces a non-2xx as plex-unavailable naming the operation and status', async () => {
    const error = await unwrapError(
      new PlexTvAccess(CONFIG, fetchStub(jsonResponse({}, 503))).createPin(),
    );
    expect(error.kind).toBe('plex-unavailable');
    expect(error.detail).toContain('pin create');
    expect(error.detail).toContain('503');
  });

  it('surfaces a contract-violating body as plex-unavailable naming the violating path', async () => {
    const error = await unwrapError(
      new PlexTvAccess(CONFIG, fetchStub(jsonResponse({ id: 'not-a-number' }))).createPin(),
    );
    expect(error.detail).toContain('contract');
    expect(error.detail).toContain('id');
  });

  it('surfaces a transport fault as plex-unavailable (fail closed, no throw escapes)', async () => {
    const error = await unwrapError(
      new PlexTvAccess(CONFIG, fetchStub(new Error('connect ECONNREFUSED'))).createPin(),
    );
    expect(error).toEqual({ kind: 'plex-unavailable', detail: 'connect ECONNREFUSED' });
  });

  it('stringifies a non-Error rejection into the detail', async () => {
    const stub = vi.fn().mockRejectedValueOnce('wat');
    const error = await unwrapError(new PlexTvAccess(CONFIG, stub as never).createPin());
    expect(error.detail).toBe('wat');
  });

  it('flattens the Error.cause chain into the detail (undici buries ECONNREFUSED there)', async () => {
    const fault = new Error('fetch failed', {
      cause: new Error('connect ECONNREFUSED 127.0.0.1:443', { cause: new Error('bad wire') }),
    });
    const error = await unwrapError(new PlexTvAccess(CONFIG, fetchStub(fault)).createPin());
    expect(error.detail).toBe('fetch failed: connect ECONNREFUSED 127.0.0.1:443: bad wire');
  });
});

describe('PlexTvAccess.checkPin', () => {
  it('reports an approved pin as authorized with its token', async () => {
    const stub = fetchStub(jsonResponse({ id: 9, authToken: 'user-token' }));
    const outcome = await unwrap(new PlexTvAccess(CONFIG, stub).checkPin(9));
    expect(outcome).toEqual({ kind: 'authorized', token: 'user-token' });
    const [url, init] = stub.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://plex.test/api/v2/pins/9');
    expect((init.headers as Record<string, string>)['Accept']).toBe('application/json');
  });

  it('reports a not-yet-approved pin (null, absent, or blank token) as pending — authorized implies a usable token', async () => {
    const nullToken = await unwrap(
      new PlexTvAccess(CONFIG, fetchStub(jsonResponse({ id: 9, authToken: null }))).checkPin(9),
    );
    expect(nullToken).toEqual({ kind: 'pending' });
    const absentToken = await unwrap(
      new PlexTvAccess(CONFIG, fetchStub(jsonResponse({ id: 9 }))).checkPin(9),
    );
    expect(absentToken).toEqual({ kind: 'pending' });
    const blankToken = await unwrap(
      new PlexTvAccess(CONFIG, fetchStub(jsonResponse({ id: 9, authToken: '' }))).checkPin(9),
    );
    expect(blankToken).toEqual({ kind: 'pending' });
  });

  it('reports a 404 as expired — a business outcome, not a fault', async () => {
    const outcome = await unwrap(
      new PlexTvAccess(CONFIG, fetchStub(jsonResponse({}, 404))).checkPin(1),
    );
    expect(outcome).toEqual({ kind: 'expired' });
  });

  it('surfaces other non-2xx statuses as plex-unavailable', async () => {
    const error = await unwrapError(
      new PlexTvAccess(CONFIG, fetchStub(jsonResponse({}, 500))).checkPin(1),
    );
    expect(error.detail).toContain('pin check');
    expect(error.detail).toContain('500');
  });

  it('surfaces a contract-violating body as plex-unavailable', async () => {
    const error = await unwrapError(
      new PlexTvAccess(CONFIG, fetchStub(jsonResponse({ authToken: 'x' }))).checkPin(1),
    );
    expect(error.detail).toContain('contract');
  });
});

describe('PlexTvAccess.checkMembership', () => {
  const USER = { id: 42, username: 'friend', title: 'Friend' };

  it('grants when a resource matches the machine id AND provides a server, sending the token as a header only', async () => {
    const stub = fetchStub(
      jsonResponse(USER),
      jsonResponse([
        { clientIdentifier: 'other', provides: 'client' },
        { clientIdentifier: 'my-server-machine', provides: 'server' },
      ]),
    );
    const outcome = await unwrap(new PlexTvAccess(CONFIG, stub).checkMembership('tok-123'));
    expect(outcome).toMatchObject({
      kind: 'granted',
      identity: { plexAccountId: '42', username: 'friend' },
    });
    // The token rides X-Plex-Token on both calls and appears in no URL.
    for (const [url, init] of stub.mock.calls as unknown as [string, RequestInit][]) {
      expect(url).not.toContain('tok-123');
      expect((init.headers as Record<string, string>)['X-Plex-Token']).toBe('tok-123');
    }
  });

  it.each([
    ['the account owns the matched server', true, 'owner'],
    ['the account merely sees a shared server', false, 'guest'],
    ['plex.tv reports no ownership flag at all', undefined, 'guest'],
  ])('derives the role from the matched entry when %s', async (_case, owned, role) => {
    const entry = { clientIdentifier: 'my-server-machine', provides: 'server' };
    const stub = fetchStub(
      jsonResponse(USER),
      jsonResponse([owned === undefined ? entry : { ...entry, owned }]),
    );
    const outcome = await unwrap(new PlexTvAccess(CONFIG, stub).checkMembership('t'));
    expect(outcome).toEqual({
      kind: 'granted',
      identity: { plexAccountId: '42', username: 'friend' },
      role,
    });
  });

  it('reads ownership from the MATCHED entry, not from any owned resource in the listing', async () => {
    // The account owns some other device; the server it reaches is a share. Role must be guest.
    const stub = fetchStub(
      jsonResponse(USER),
      jsonResponse([
        { clientIdentifier: 'my-laptop', provides: 'client', owned: true },
        { clientIdentifier: 'my-server-machine', provides: 'server', owned: false },
      ]),
    );
    const outcome = await unwrap(new PlexTvAccess(CONFIG, stub).checkMembership('t'));
    expect(outcome).toMatchObject({ kind: 'granted', role: 'guest' });
  });

  it('denies a matching identifier that does not provide a server — the forged-device attack shape', async () => {
    // Device/player identifiers are CLIENT-CHOSEN: an attacker's player can claim the (public)
    // server machine id. The identifier match alone must never admit it.
    const stub = fetchStub(
      jsonResponse(USER),
      jsonResponse([{ clientIdentifier: 'my-server-machine', provides: 'client,player' }]),
    );
    const outcome = await unwrap(new PlexTvAccess(CONFIG, stub).checkMembership('t'));
    expect(outcome).toEqual({
      kind: 'denied',
      username: 'friend',
      reason: 'matched-non-server',
    });
  });

  it('never reads the role from an entry that failed the predicate (same-id device + real server)', async () => {
    // The escalation shape: a guest's own device claims the server's identifier and is `owned` by
    // that guest, while the server they actually reach is a share. Role must come from the entry
    // that ADMITTED them, so this is a guest — reading `owned` off the device would mint an owner.
    const stub = fetchStub(
      jsonResponse(USER),
      jsonResponse([
        { clientIdentifier: 'my-server-machine', provides: 'client,player', owned: true },
        { clientIdentifier: 'my-server-machine', provides: 'server', owned: false },
      ]),
    );
    const outcome = await unwrap(new PlexTvAccess(CONFIG, stub).checkMembership('t'));
    expect(outcome).toEqual({
      kind: 'granted',
      identity: { plexAccountId: '42', username: 'friend' },
      role: 'guest',
    });
  });

  const OWNED_SERVER = { clientIdentifier: 'my-server-machine', provides: 'server', owned: true };
  const SHARED_SERVER = { clientIdentifier: 'my-server-machine', provides: 'server', owned: false };

  it.each([
    ['the owned entry first', [OWNED_SERVER, SHARED_SERVER]],
    ['the shared entry first', [SHARED_SERVER, OWNED_SERVER]],
  ])(
    'decides the role independently of listing order when a machine id appears twice: %s',
    async (_case, listing) => {
      // Duplicate machine identifiers happen in the wild (cloned VMs, restored Preferences.xml):
      // owner iff ANY admitting entry is owned, so plex.tv's array order cannot decide privilege.
      const stub = fetchStub(jsonResponse(USER), jsonResponse(listing));
      const outcome = await unwrap(new PlexTvAccess(CONFIG, stub).checkMembership('t'));
      expect(outcome).toMatchObject({ kind: 'granted', role: 'owner' });
    },
  );

  it('finds server among a multi-value provides list, trimmed and case-insensitively', async () => {
    const stub = fetchStub(
      jsonResponse(USER),
      jsonResponse([{ clientIdentifier: 'my-server-machine', provides: 'client, Server ,sync' }]),
    );
    const outcome = await unwrap(new PlexTvAccess(CONFIG, stub).checkMembership('t'));
    expect(outcome).toMatchObject({ kind: 'granted' });
  });

  it('denies a matching identifier whose entry carries no provides at all, naming the drift shape', async () => {
    // Absent capabilities is the plex.tv CONTRACT-DRIFT shape: it denies (tolerance never grants),
    // and the reason must distinguish it, because that drift locks out every user at once.
    const stub = fetchStub(
      jsonResponse(USER),
      jsonResponse([{ clientIdentifier: 'my-server-machine' }]),
    );
    const outcome = await unwrap(new PlexTvAccess(CONFIG, stub).checkMembership('t'));
    expect(outcome).toEqual({
      kind: 'denied',
      username: 'friend',
      reason: 'matched-no-capabilities',
    });
  });

  it('denies when no resource matches, carrying the username for the denial message', async () => {
    const stub = fetchStub(
      jsonResponse(USER),
      jsonResponse([{ clientIdentifier: 'other', provides: 'server' }]),
    );
    const outcome = await unwrap(new PlexTvAccess(CONFIG, stub).checkMembership('t'));
    expect(outcome).toEqual({ kind: 'denied', username: 'friend', reason: 'no-machine-match' });
  });

  it.each([
    [
      'falls back to title when username is missing',
      { id: 7, title: 'Managed Kid' },
      'Managed Kid',
    ],
    ['falls back to the account id when both are missing', { id: 7 }, '7'],
  ])('%s', async (_case, user, expected) => {
    const stub = fetchStub(jsonResponse(user), jsonResponse([]));
    const outcome = await unwrap(new PlexTvAccess(CONFIG, stub).checkMembership('t'));
    expect(outcome).toMatchObject({ kind: 'denied', username: expected });
  });

  it('surfaces a user-lookup failure as plex-unavailable with a token-free detail', async () => {
    const error = await unwrapError(
      new PlexTvAccess(CONFIG, fetchStub(jsonResponse({}, 401))).checkMembership('secret-tok'),
    );
    expect(error.detail).toContain('user lookup');
    expect(error.detail).toContain('401');
    expect(error.detail).not.toContain('secret-tok');
  });

  it('surfaces a resources failure as plex-unavailable', async () => {
    const error = await unwrapError(
      new PlexTvAccess(
        CONFIG,
        fetchStub(jsonResponse(USER), jsonResponse({}, 500)),
      ).checkMembership('t'),
    );
    expect(error.detail).toContain('resources');
  });

  it('surfaces contract violations in either body as plex-unavailable', async () => {
    const badUser = await unwrapError(
      new PlexTvAccess(CONFIG, fetchStub(jsonResponse({ username: 1 }))).checkMembership('t'),
    );
    expect(badUser.detail).toContain('contract');
    const badResources = await unwrapError(
      new PlexTvAccess(
        CONFIG,
        fetchStub(jsonResponse(USER), jsonResponse([{ clientIdentifier: 1 }])),
      ).checkMembership('t'),
    );
    expect(badResources.detail).toContain('contract');
  });

  it('names a root-level contract violation as (root) rather than an empty path', async () => {
    // A resources body that is not an array violates at the root: the path is empty, and the
    // detail must still say WHERE.
    const error = await unwrapError(
      new PlexTvAccess(CONFIG, fetchStub(jsonResponse(USER), jsonResponse('nope'))).checkMembership(
        't',
      ),
    );
    expect(error.detail).toContain('(root)');
  });
});

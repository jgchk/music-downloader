import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { authorize } from './authz.js';
import type { PrivilegedAction } from './authz.js';
import { SESSION_TTL_MS, verifySession } from './session.js';
import type { SessionClaims, SessionVerdict } from './session.js';

/**
 * The permission question (web-authorization): every privileged action is decided HERE, from the
 * presenting session and the action name alone. These tests exercise the real decision path with
 * minted claims — there is no external actor behind a pure decision, so there is nothing to fake.
 */

const OWNER_GATED: PrivilegedAction = 'system:redrive';

function claims(role: 'owner' | 'guest'): SessionClaims {
  return {
    plexAccountId: '42',
    username: 'someone',
    role,
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
}

describe('authorize', () => {
  it('permits an owner the action gated to owners', () => {
    expect(authorize(claims('owner'), OWNER_GATED)).toEqual({ kind: 'permitted' });
  });

  it('refuses a guest the action gated to owners — a modeled outcome, never a throw', () => {
    expect(authorize(claims('guest'), OWNER_GATED)).toEqual({ kind: 'refused' });
  });

  it('refuses a session issued before roles existed — decoded through the real codec, no cast', () => {
    // End to end from the wire: a validly signed cookie carrying no role claim reaches this
    // decision point as a guest, so owner-gated work refuses it (privilege never by omission).
    const secret = 'authz-test-secret';
    const payload = Buffer.from(
      JSON.stringify({ plexAccountId: '42', username: 'someone', expiresAt: Date.now() + 1000 }),
    ).toString('base64url');
    const signature = createHmac('sha256', secret).update(payload).digest('base64url');
    const verdict = verifySession(`${payload}.${signature}`, secret, Date.now());

    expect(verdict.kind).toBe('valid');
    const decoded = verdict as Extract<SessionVerdict, { kind: 'valid' }>;
    expect(authorize(decoded.claims, OWNER_GATED)).toEqual({ kind: 'refused' });
  });

  it('decides from the session and the action alone: asking twice gives the identical answer', () => {
    const session = claims('guest');
    expect(authorize(session, OWNER_GATED)).toEqual(authorize(session, OWNER_GATED));
    const owner = claims('owner');
    expect(authorize(owner, OWNER_GATED)).toEqual(authorize(owner, OWNER_GATED));
  });

  it('ignores identity facts: two sessions with the same role decide the same', () => {
    const one = { ...claims('guest'), plexAccountId: '1', username: 'a' };
    const other = { ...claims('guest'), plexAccountId: '2', username: 'b' };
    expect(authorize(one, OWNER_GATED)).toEqual(authorize(other, OWNER_GATED));
  });
});

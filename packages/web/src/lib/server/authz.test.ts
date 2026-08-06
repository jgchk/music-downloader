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

/** Every action the closed union carries. Adding a member here is the compiler's job to demand. */
const EVERY_ACTION: readonly PrivilegedAction[] = ['system:redrive'];

// A fixed clock, never Date.now(): a decision must not depend on wall time, and a test must not
// race one (the house pattern — see session.test.ts).
const NOW = Date.UTC(2026, 0, 1);

function claims(role: 'owner' | 'guest'): SessionClaims {
  return {
    plexAccountId: '42',
    username: 'someone',
    role,
    expiresAt: NOW + SESSION_TTL_MS,
  };
}

describe('authorize', () => {
  it('permits an owner the action gated to owners', () => {
    expect(authorize(claims('owner'), OWNER_GATED)).toEqual({ kind: 'permitted' });
  });

  it('refuses a guest the action gated to owners — a modeled outcome, never a throw', () => {
    expect(authorize(claims('guest'), OWNER_GATED)).toEqual({ kind: 'refused' });
  });

  it('refuses a session issued before roles existed — claims decoded by the real codec, not fabricated', () => {
    // End to end from the wire: a validly signed cookie carrying no role claim reaches this
    // decision point as a guest, so owner-gated work refuses it (privilege never by omission).
    const secret = 'authz-test-secret';
    const payload = Buffer.from(
      JSON.stringify({
        plexAccountId: '42',
        username: 'someone',
        expiresAt: NOW + SESSION_TTL_MS,
      }),
    ).toString('base64url');
    const signature = createHmac('sha256', secret).update(payload).digest('base64url');
    const verdict: SessionVerdict = verifySession(`${payload}.${signature}`, secret, NOW);

    if (verdict.kind !== 'valid') throw new Error(`expected a valid verdict, got ${verdict.kind}`);
    expect(authorize(verdict.claims, OWNER_GATED)).toEqual({ kind: 'refused' });
  });

  it.each(EVERY_ACTION)(
    'permits an owner %s — the table is a MINIMUM, not an exact match',
    (action) => {
      // Pins the role ladder before a guest-rung action exists to expose it: an owner must satisfy
      // anything any lesser role satisfies, so an accidental equality check (or an inverted rank)
      // cannot pass. The `it.each` grows with the union, keeping the property total.
      expect(authorize(claims('owner'), action)).toEqual({ kind: 'permitted' });
    },
  );

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

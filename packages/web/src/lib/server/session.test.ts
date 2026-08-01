import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SESSION_TTL_MS, signSession, verifySession } from './session.js';

const SECRET = 'unit-test-secret';
const NOW = Date.UTC(2026, 0, 1);
const IDENTITY = { plexAccountId: '12345', username: 'jake' };

describe('session codec', () => {
  it('round-trips identity claims through sign and verify', () => {
    const cookie = signSession(IDENTITY, SECRET, NOW);
    const verdict = verifySession(cookie, SECRET, NOW);
    expect(verdict).toEqual({
      kind: 'valid',
      claims: { ...IDENTITY, expiresAt: NOW + SESSION_TTL_MS },
    });
  });

  it('fixes expiry inside the signed claims at seven days from issue (codec-level, tamper-proof)', () => {
    // The TTL is the design's re-verification cadence (D4): it must live in the signed payload,
    // not in cookie metadata a client could strip or extend.
    expect(SESSION_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
    const cookie = signSession(IDENTITY, SECRET, NOW);
    expect(verifySession(cookie, SECRET, NOW + SESSION_TTL_MS - 1).kind).toBe('valid');
  });

  it('reports a session past its expiry as expired, not valid — activity never extends it', () => {
    const cookie = signSession(IDENTITY, SECRET, NOW);
    expect(verifySession(cookie, SECRET, NOW + SESSION_TTL_MS).kind).toBe('expired');
    expect(verifySession(cookie, SECRET, NOW + SESSION_TTL_MS * 52).kind).toBe('expired');
  });

  it('rejects a cookie signed with a different secret (rotation revokes every session)', () => {
    const cookie = signSession(IDENTITY, SECRET, NOW);
    expect(verifySession(cookie, 'rotated-secret', NOW)).toEqual({ kind: 'invalid' });
  });

  it('rejects a tampered payload even when the original signature is kept', () => {
    const cookie = signSession(IDENTITY, SECRET, NOW);
    const [payload, signature] = cookie.split('.') as [string, string];
    const forged = Buffer.from(
      JSON.stringify({
        plexAccountId: '999',
        username: 'intruder',
        expiresAt: NOW + SESSION_TTL_MS * 999,
      }),
    ).toString('base64url');
    expect(verifySession(`${forged}.${signature}`, SECRET, NOW)).toEqual({ kind: 'invalid' });
    expect(payload).not.toBe(forged);
  });

  it.each([
    ['empty string', ''],
    ['no signature separator', 'justonepart'],
    ['garbage base64 payload', '%%%%.sig'],
    ['non-JSON payload', `${Buffer.from('not json').toString('base64url')}.sig`],
    [
      'JSON payload missing the claims shape',
      `${Buffer.from(JSON.stringify({ hello: 'world' })).toString('base64url')}.sig`,
    ],
    [
      'claims with a non-numeric expiry',
      `${Buffer.from(
        JSON.stringify({ plexAccountId: '1', username: 'x', expiresAt: 'never' }),
      ).toString('base64url')}.sig`,
    ],
  ])('rejects a malformed cookie as invalid, never throwing: %s', (_case, cookie) => {
    expect(verifySession(cookie, SECRET, NOW)).toEqual({ kind: 'invalid' });
  });

  it('rejects a signature of the wrong length without throwing (timing-safe compare guard)', () => {
    const [payload] = signSession(IDENTITY, SECRET, NOW).split('.') as [string];
    expect(verifySession(`${payload}.abc`, SECRET, NOW)).toEqual({ kind: 'invalid' });
  });

  // A payload that passes the SIGNATURE check but fails claims parsing can only exist if the
  // secret holder signed garbage — it must still be a verdict, never a throw.
  it.each([
    ['non-JSON', 'not json'],
    ['JSON of the wrong shape', JSON.stringify({ hello: 'world' })],
  ])('rejects a correctly-signed but unparsable payload as invalid: %s', (_case, raw) => {
    const payload = Buffer.from(raw).toString('base64url');
    const signature = createHmac('sha256', SECRET).update(payload).digest('base64url');
    expect(verifySession(`${payload}.${signature}`, SECRET, NOW)).toEqual({ kind: 'invalid' });
  });
});

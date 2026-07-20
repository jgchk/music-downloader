import { type CryptoKey, SignJWT, generateKeyPair } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  PROTECTED_RESOURCE_METADATA_PATH,
  createTokenVerifier,
  protectedResourceMetadata,
  resourceMetadataUrl,
} from './auth.js';
import type { KeySource } from './auth.js';

const ISSUER = 'https://auth.jake.cafe/realms/homelab';
const RESOURCE = 'https://music-dl.jake.cafe/mcp';

let privateKey: CryptoKey;
let publicKey: CryptoKey;

beforeAll(async () => {
  ({ privateKey, publicKey } = await generateKeyPair('RS256'));
});

const nowSec = (): number => Math.floor(Date.now() / 1000);

async function sign(
  claims: Record<string, unknown>,
  opts: { issuer?: string; subject?: string; exp?: number; key?: CryptoKey } = {},
): Promise<string> {
  let jwt = new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(opts.issuer ?? ISSUER)
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? nowSec() + 3600);
  if (opts.subject !== undefined) jwt = jwt.setSubject(opts.subject);
  return jwt.sign(opts.key ?? privateKey);
}

function verifier(keySource: KeySource = publicKey) {
  return createTokenVerifier({ issuer: ISSUER, resource: RESOURCE, keySource });
}

describe('protected resource metadata', () => {
  it('advertises the resource, its authorization server, and header bearer method (RFC 9728)', () => {
    expect(protectedResourceMetadata(ISSUER, RESOURCE)).toEqual({
      resource: RESOURCE,
      authorization_servers: [ISSUER],
      bearer_methods_supported: ['header'],
    });
  });

  it('locates the metadata document at the resource origin well-known path', () => {
    expect(resourceMetadataUrl(RESOURCE)).toBe(
      `https://music-dl.jake.cafe${PROTECTED_RESOURCE_METADATA_PATH}`,
    );
  });
});

describe('createTokenVerifier', () => {
  it('accepts a well-formed token audience-bound to the resource via aud, exposing the subject', async () => {
    const token = await sign({ aud: RESOURCE }, { subject: 'user-1' });
    const result = await verifier().verify(`Bearer ${token}`);
    expect(result._unsafeUnwrap()).toEqual({ subject: 'user-1' });
  });

  it('accepts a token with no subject, leaving the subject undefined', async () => {
    const token = await sign({ aud: RESOURCE });
    expect((await verifier().verify(`Bearer ${token}`))._unsafeUnwrap()).toEqual({
      subject: undefined,
    });
  });

  it('accepts the resource carried in an aud array', async () => {
    const token = await sign({ aud: ['https://other', RESOURCE] });
    expect((await verifier().verify(`Bearer ${token}`)).isOk()).toBe(true);
  });

  it('accepts the resource carried in the RFC 8707 resource claim', async () => {
    const token = await sign({ resource: RESOURCE });
    expect((await verifier().verify(`Bearer ${token}`)).isOk()).toBe(true);
  });

  it('accepts the resource carried in azp', async () => {
    const token = await sign({ azp: RESOURCE });
    expect((await verifier().verify(`Bearer ${token}`)).isOk()).toBe(true);
  });

  it('is case-insensitive on the Bearer scheme and tolerant of surrounding whitespace', async () => {
    const token = await sign({ aud: RESOURCE });
    expect((await verifier().verify(`  bearer   ${token}  `)).isOk()).toBe(true);
  });

  it('rejects a missing Authorization header as MissingToken', async () => {
    expect((await verifier().verify(undefined))._unsafeUnwrapErr()).toEqual({
      kind: 'MissingToken',
    });
  });

  it('rejects a non-Bearer or malformed header as MissingToken', async () => {
    for (const header of ['Basic abc', 'Bearer', 'Bearer ', 'Bearer a b', '']) {
      expect((await verifier().verify(header))._unsafeUnwrapErr()).toEqual({
        kind: 'MissingToken',
      });
    }
  });

  it('rejects a token whose audience does not include the resource', async () => {
    const token = await sign({ aud: ['https://other', 123] });
    expect((await verifier().verify(`Bearer ${token}`))._unsafeUnwrapErr()).toEqual({
      kind: 'InvalidToken',
      reason: 'audience',
    });
  });

  it('rejects a token with no audience claims at all', async () => {
    const token = await sign({});
    expect((await verifier().verify(`Bearer ${token}`))._unsafeUnwrapErr().kind).toBe(
      'InvalidToken',
    );
  });

  it('rejects a token signed by an unknown key (bad signature)', async () => {
    const other = await generateKeyPair('RS256');
    const token = await sign({ aud: RESOURCE }, { key: other.privateKey });
    const result = await verifier().verify(`Bearer ${token}`);
    expect(result._unsafeUnwrapErr().kind).toBe('InvalidToken');
  });

  it('rejects an expired token', async () => {
    const token = await sign({ aud: RESOURCE }, { exp: nowSec() - 60 });
    expect((await verifier().verify(`Bearer ${token}`))._unsafeUnwrapErr().kind).toBe(
      'InvalidToken',
    );
  });

  it('rejects a token from the wrong issuer', async () => {
    const token = await sign({ aud: RESOURCE }, { issuer: 'https://evil.example/realms/x' });
    expect((await verifier().verify(`Bearer ${token}`))._unsafeUnwrapErr().kind).toBe(
      'InvalidToken',
    );
  });

  it('maps a non-Error thrown by the key source to a generic invalid-token reason', async () => {
    const token = await sign({ aud: RESOURCE });
    const throwing: KeySource = () => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- exercise the non-Error branch
      throw 'not-an-error';
    };
    expect((await verifier(throwing).verify(`Bearer ${token}`))._unsafeUnwrapErr()).toEqual({
      kind: 'InvalidToken',
      reason: 'invalid',
    });
  });
});

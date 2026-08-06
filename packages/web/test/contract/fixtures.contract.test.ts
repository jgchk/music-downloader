import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ZodType } from 'zod';
import {
  plexPinCheckSchema,
  plexPinCreateSchema,
  plexResourcesSchema,
  plexUserSchema,
} from '../../src/lib/server/plex/schemas.js';
import { CONTRACT_FIXTURE_ROOT, loadFixtures } from './support/fixture.js';

/**
 * Fixture fidelity + scrub proof (external-api-contracts): every recorded plex.tv fixture must
 * validate against the consumed-surface schemas — and, per the slskd-recorder lesson, must
 * demonstrably carry NO live token and NO account/machine data beyond the pseudonymized consumed
 * fields. These assertions make an unscrubbed re-recording fail the commit gate, not a review.
 */

const fixtures = loadFixtures('plextv');
const byName = (name: string) => {
  const hit = fixtures.find((f) => f.name === name);
  if (hit === undefined) throw new Error(`missing fixture ${name}`);
  return hit;
};

/** Which schema governs each 2xx fixture body. */
const SCHEMAS: Record<string, ZodType> = {
  'pin-create.json': plexPinCreateSchema,
  'pin-check-authorized.json': plexPinCheckSchema,
  'pin-check-pending.json': plexPinCheckSchema,
  'user.json': plexUserSchema,
  'resources.json': plexResourcesSchema,
};

describe('plex.tv fixtures', () => {
  it('cover exactly the consumed surface', () => {
    expect(fixtures.map((f) => f.name).sort()).toEqual(
      [...Object.keys(SCHEMAS), 'pin-check-expired.json'].sort(),
    );
  });

  it.each(Object.entries(SCHEMAS))('%s conforms to its consumed schema', (name, schema) => {
    const { fixture } = byName(name);
    expect(fixture.response.status).toBeGreaterThanOrEqual(200);
    expect(fixture.response.status).toBeLessThan(300);
    const parsed = schema.safeParse(fixture.response.body);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it('records the expired outcome as plex.tv answers it: a 404 status', () => {
    expect(byName('pin-check-expired.json').fixture.response.status).toBe(404);
  });

  it('carries every fixture with provenance (source + capture date)', () => {
    for (const { fixture } of fixtures) {
      expect(fixture.provenance.source).toMatch(/\S/);
      expect(fixture.provenance.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('holds NO live token: the authorized check carries exactly the scrub placeholder', () => {
    const body = byName('pin-check-authorized.json').fixture.response.body as {
      authToken: string;
    };
    expect(body.authToken).toBe('plex-user-token-scrubbed');
  });

  it('holds no account data beyond the pseudonymized consumed identity', () => {
    const body = byName('user.json').fixture.response.body as Record<string, unknown>;
    // The recorder preserves which consumed fields the wire carried (and their null-ness) but
    // every present string value must be the pseudonym — nothing real survives.
    expect(['id', 'title', 'username']).toEqual(expect.arrayContaining(Object.keys(body)));
    expect(body['id']).toBe(1);
    for (const field of ['username', 'title']) {
      if (typeof body[field] === 'string') expect(body[field]).toMatch(/^user\d+$/);
      else expect([null, undefined]).toContain(body[field]);
    }
  });

  it('holds only pseudonymized machine identifiers and the consumed predicate fields', () => {
    const body = byName('resources.json').fixture.response.body as Record<string, unknown>[];
    expect(body.length).toBeGreaterThan(0);
    for (const entry of body) {
      // The consumed set, nothing else: the identifier is pseudonymized, while `provides` and
      // `owned` are plex.tv's own vocabulary (a capability list and a boolean) and identify
      // nobody — they are recorded verbatim so the predicate meets the real spelling.
      const allowed = new Set(['clientIdentifier', 'provides', 'owned']);
      // Names the offending keys on failure (and cannot be "fixed" into the inverse assertion,
      // which would let unscrubbed fields through).
      expect(Object.keys(entry).filter((key) => !allowed.has(key))).toEqual([]);
      expect(entry['clientIdentifier']).toMatch(/^machine-\d+$/);
      if ('provides' in entry) expect(typeof entry['provides']).toBe('string');
      if ('owned' in entry) expect(typeof entry['owned']).toBe('boolean');
    }
  });

  it('contains no token-shaped or secret-bearing text anywhere in the raw files', () => {
    const dir = join(CONTRACT_FIXTURE_ROOT, 'plextv');
    for (const name of readdirSync(dir)) {
      const raw = readFileSync(join(dir, name), 'utf8');
      // A real transient token would be a long opaque string tied to these key names; the only
      // permitted value for authToken is the placeholder, and no other credential key may appear.
      expect(raw).not.toMatch(/"authToken"\s*:\s*"(?!plex-user-token-scrubbed")/);
      expect(raw).not.toMatch(/accessToken|X-Plex-Token|authenticationToken/i);
    }
  });
});

describe('E2E plex.tv stub payloads conform to the contract', () => {
  // The E2E tier is product-level and lives at the workspace root (external-api-contracts:
  // "E2E stub payloads conform to the contract" — the doubles must not drift from the schemas).
  const STUB_ROOT = new URL('../../../../test/e2e/stubs/plextv/mappings/', import.meta.url)
    .pathname;

  const STUB_SCHEMAS: Record<string, ZodType> = {
    'pins-create.json': plexPinCreateSchema,
    'pin-check-member.json': plexPinCheckSchema,
    'pin-check-stranger.json': plexPinCheckSchema,
    'user-member.json': plexUserSchema,
    'user-stranger.json': plexUserSchema,
    'resources-member.json': plexResourcesSchema,
    'resources-stranger.json': plexResourcesSchema,
  };

  it('every mapping is schema-governed (a new stub must register here)', () => {
    expect(readdirSync(STUB_ROOT).sort()).toEqual(Object.keys(STUB_SCHEMAS).sort());
  });

  it.each(Object.entries(STUB_SCHEMAS))('%s validates against its schema', (name, schema) => {
    const mapping = JSON.parse(readFileSync(join(STUB_ROOT, name), 'utf8')) as {
      response: { jsonBody: unknown };
    };
    const parsed = schema.safeParse(mapping.response.jsonBody);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });
});

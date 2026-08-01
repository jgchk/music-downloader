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
const byName = (name: string) => fixtures.find((f) => f.name === name)!;

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
    expect(Object.keys(body).sort()).toEqual(['id', 'title', 'username']);
    expect(body['username']).toMatch(/^user\d+$/);
    expect(body['title']).toMatch(/^user\d+$/);
  });

  it('holds only pseudonymized machine identifiers, one consumed field per resource', () => {
    const body = byName('resources.json').fixture.response.body as Record<string, unknown>[];
    expect(body.length).toBeGreaterThan(0);
    for (const entry of body) {
      expect(Object.keys(entry)).toEqual(['clientIdentifier']);
      expect(entry['clientIdentifier']).toMatch(/^machine-\d+$/);
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

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadFixtures } from './support/fixture.js';
import {
  fixtureRequiredFields,
  fixtureSchemas,
  stubSchemas,
  unconsumedResponseFixtures,
} from './support/registry.js';

/**
 * Conformance: every recorded fixture and every E2E stub payload must satisfy the same contract
 * schemas the runtime adapters enforce (change: external-api-contract-tests). This is what stops
 * the doubles from silently drifting away from the contract — the failure mode that let the slskd
 * transfers-shape bug through before this change.
 */

// The E2E tier is product-level and lives at the workspace root (the stubs serve the whole loop).
const STUB_ROOT = new URL('../../../../test/e2e/stubs/', import.meta.url).pathname;

describe('recorded fixtures conform to the contract', () => {
  const fixtures = [
    ...loadFixtures('musicbrainz').map((f) => ({ ...f, service: 'musicbrainz' })),
    ...loadFixtures('slskd').map((f) => ({ ...f, service: 'slskd' })),
  ];

  it.each(fixtures)('$service/$name carries provenance', ({ fixture }) => {
    expect(fixture.provenance.source).toBeTruthy();
    expect(fixture.provenance.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(fixture.request.method).toMatch(/^(GET|POST|DELETE)$/);
  });

  // Completeness (the web tier's pattern): every fixture on disk is either bound to a schema or
  // explicitly declared response-unconsumed in the registry. Without this, a fixture whose
  // registration was forgotten would silently escape validation via the skip below.
  it('every fixture is registered or explicitly declared unconsumed', () => {
    const onDisk = fixtures.map((f) => `${f.service}/${f.name}`).sort();
    const known = [...Object.keys(fixtureSchemas), ...unconsumedResponseFixtures].sort();
    expect(onDisk).toEqual(known);
  });

  it.each(fixtures)(
    '$service/$name response validates against its schema',
    ({ service, name, fixture }) => {
      const schema = fixtureSchemas[`${service}/${name}`];
      if (schema === undefined) {
        // Only a declared unconsumed-response fixture may skip validation; the completeness
        // assertion above keeps this set and the disk in exact agreement.
        expect(unconsumedResponseFixtures).toContain(`${service}/${name}`);
        return;
      }
      const result = schema.safeParse(fixture.response.body);
      expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
    },
  );

  // Tolerant-reader schemas accept a capture that *lost* a consumed field, which would silently
  // disarm the guards branching on it — presence is asserted separately for exactly those fields.
  const witnessed = Object.entries(fixtureRequiredFields).map(([key, fields]) => ({ key, fields }));

  it.each(witnessed)('$key witnesses its consumed integrity fields', ({ key, fields }) => {
    const [service, name] = key.split('/');
    const match = fixtures.find((f) => f.service === service && f.name === name);
    expect(match, `${key} fixture missing`).toBeDefined();
    const body = match!.fixture.response.body as Record<string, unknown>;
    for (const field of fields) {
      expect(body[field], `${key} no longer carries consumed field '${field}'`).toBeDefined();
    }
  });
});

describe('E2E stub payloads conform to the contract', () => {
  const cases = Object.keys(stubSchemas).map((rel) => ({ rel }));

  it.each(cases)('%s validates against its schema', ({ rel }) => {
    const mapping = JSON.parse(
      readFileSync(join(STUB_ROOT, `${rel.split('/')[0]}/mappings/${rel.split('/')[1]}`), 'utf8'),
    ) as {
      response: { jsonBody?: unknown };
    };
    const result = stubSchemas[rel]!.safeParse(mapping.response.jsonBody);
    expect(result.success, `${rel}: ${JSON.stringify(result.error?.issues)}`).toBe(true);
  });
});

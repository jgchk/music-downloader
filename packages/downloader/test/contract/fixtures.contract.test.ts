import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadFixtures } from './support/fixture.js';
import { fixtureSchemas, stubSchemas } from './support/registry.js';

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

  it.each(fixtures)(
    '$service/$name response validates against its schema',
    ({ service, name, fixture }) => {
      const schema = fixtureSchemas[`${service}/${name}`];
      if (schema === undefined) return; // endpoint whose response the adapter does not consume
      const result = schema.safeParse(fixture.response.body);
      expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
    },
  );
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

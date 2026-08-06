import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadFixtures } from './support/fixture.js';
import {
  fixtureRequiredFields,
  fixtureSchemas,
  scriptedStubSchemas,
  scriptedStubsWithoutContract,
  stubSchemas,
  unconsumedResponseFixtures,
  unconsumedStubMappings,
} from './support/registry.js';
import { CONTRACT_FIXTURE_ROOT } from './support/fixture.js';
import { slskdDownloadFileCompleteSchema } from '../../src/adapters/slskd/schemas.js';

/**
 * Conformance: every recorded fixture and every E2E stub payload must satisfy the same contract
 * schemas the runtime adapters enforce (change: external-api-contract-tests). This is what stops
 * the doubles from silently drifting away from the contract — the failure mode that let the slskd
 * transfers-shape bug through before this change.
 */

// The E2E tier is product-level and lives at the workspace root (the stubs serve the whole loop).
const STUB_ROOT = new URL('../../../../test/e2e/stubs/', import.meta.url).pathname;

// Fixture directories validated by their own dedicated tiers, not this conformance suite —
// events/ by the events-upcast + events-fold contract tests, ffprobe/ by the ffprobe contract
// test. Everything else on disk is THIS suite's remit, so a new service directory fails the
// completeness assertions below instead of escaping wholesale.
const OWN_TIER_FIXTURE_DIRS = ['events', 'ffprobe'];

describe('recorded fixtures conform to the contract', () => {
  const services = readdirSync(CONTRACT_FIXTURE_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !OWN_TIER_FIXTURE_DIRS.includes(entry.name))
    .map((entry) => entry.name)
    .sort();
  const fixtures = services.flatMap((service) =>
    loadFixtures(service).map((f) => ({ ...f, service })),
  );

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
    // A fixture name is a path relative to its service directory, so it may itself contain a
    // slash (`live/search-state.json`) — split off only the service.
    const separator = key.indexOf('/');
    const service = key.slice(0, separator);
    const name = key.slice(separator + 1);
    const match = fixtures.find((f) => f.service === service && f.name === name);
    expect(match, `${key} fixture missing`).toBeDefined();
    const body = match!.fixture.response.body as Record<string, unknown>;
    for (const field of fields) {
      expect(body[field], `${key} no longer carries consumed field '${field}'`).toBeDefined();
    }
  });
});

describe('E2E stub payloads conform to the contract', () => {
  // plextv stubs belong to the web package's contract tier, which carries its own completeness
  // assertion over that directory — excluded here so neither tier double-covers or misses it.
  const stubServices = readdirSync(STUB_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'plextv')
    .map((entry) => entry.name)
    .sort();
  const onDisk = stubServices.flatMap((service) =>
    readdirSync(join(STUB_ROOT, service, 'mappings'))
      .filter((name) => name.endsWith('.json'))
      .map((name) => `${service}/${name}`),
  );

  // Completeness, mirroring the fixture side: every mapping on disk is either schema-bound or
  // explicitly declared response-unconsumed — a body-less DELETE ack is a deliberate
  // declaration, not indistinguishable from a forgotten registration.
  it('every stub mapping is registered or explicitly declared unconsumed', () => {
    const known = [...Object.keys(stubSchemas), ...unconsumedStubMappings].sort();
    expect([...onDisk].sort()).toEqual(known);
  });

  const cases = onDisk.map((rel) => ({ rel }));

  it.each(cases)('$rel validates against its schema', ({ rel }) => {
    const schema = stubSchemas[rel];
    if (schema === undefined) {
      expect(unconsumedStubMappings).toContain(rel);
      return;
    }
    const mapping = JSON.parse(
      readFileSync(join(STUB_ROOT, `${rel.split('/')[0]}/mappings/${rel.split('/')[1]}`), 'utf8'),
    ) as {
      response: { jsonBody?: unknown };
    };
    const result = schema.safeParse(mapping.response.jsonBody);
    expect(result.success, `${rel}: ${JSON.stringify(result.error?.issues)}`).toBe(true);
  });
});

describe('scripted E2E stub payloads conform to the contract', () => {
  // Ad-hoc-registered doubles (review-resolution's second-hunt script) get exactly the same
  // conformance gate as the permanent stubs — an inline payload would drift silently and
  // surface only as a post-merge e2e failure, the class of bug this tier exists to prevent.
  const cases = Object.keys(scriptedStubSchemas).map((rel) => ({ rel }));

  it.each(cases)('%s validates against its schema', ({ rel }) => {
    const mapping = JSON.parse(readFileSync(join(STUB_ROOT, rel), 'utf8')) as {
      response: { jsonBody?: unknown };
    };
    const result = scriptedStubSchemas[rel]!.safeParse(mapping.response.jsonBody);
    expect(result.success, `${rel}: ${JSON.stringify(result.error?.issues)}`).toBe(true);
  });

  it('every scripted stub on disk is either contract-mapped or deliberately excluded', () => {
    // The e2e phase registers whatever the directory contains; this sweep stops a future file
    // from being loaded into WireMock while validating against nothing.
    const onDisk = readdirSync(join(STUB_ROOT, 'slskd/scripted')).map(
      (name) => `slskd/scripted/${name}`,
    );
    const accounted = new Set([
      ...Object.keys(scriptedStubSchemas),
      ...scriptedStubsWithoutContract,
    ]);
    for (const rel of onDisk) {
      expect(accounted.has(rel), `${rel} is neither contract-mapped nor excluded`).toBe(true);
    }
    // And the maps point at real files — a stale registry entry is drift in the other direction.
    for (const rel of accounted) {
      expect(onDisk.includes(rel), `${rel} is registered but not on disk`).toBe(true);
    }
  });

  it('the scripted events journal carries decodable DownloadFileComplete payloads', () => {
    // The events schema only asserts `data` is a string; the string-encoded payload is where a
    // shape mistake is easiest to make — decode each one with the adapter's own schema.
    const mapping = JSON.parse(
      readFileSync(join(STUB_ROOT, 'slskd/scripted/events-both-completes.json'), 'utf8'),
    ) as { response: { jsonBody: { type: string; data: string }[] } };
    for (const record of mapping.response.jsonBody) {
      const decoded = slskdDownloadFileCompleteSchema.safeParse(JSON.parse(record.data));
      expect(decoded.success, JSON.stringify(decoded.error?.issues)).toBe(true);
    }
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  SLSKD_CONSUMED_OPERATIONS,
  undeclaredOperations,
  undeclaredQueryParams,
} from './support/slskd-manifest.js';
import type { IssuedRequest } from './support/slskd-manifest.js';
import { checkSlskdSpec } from './support/spec-compat.js';
import type { OpenApiSpec } from './support/spec-compat.js';

/**
 * Pins the consumed-surface manifest against the committed slskd spec snapshot (task 4.3). If the
 * manifest ever names an operation, path parameter, or request field the pinned spec doesn't
 * declare, this fails — the same checker the drift tier runs against newer slskd releases, proven
 * here to hold for the version we build against.
 */

const SPEC_DIR = new URL('slskd-spec/', import.meta.url).pathname;

describe('slskd consumed surface (pinned snapshot)', () => {
  const provenance = JSON.parse(readFileSync(`${SPEC_DIR}provenance.json`, 'utf8')) as {
    specPath: string;
    pinnedVersion: string;
  };
  const spec = JSON.parse(readFileSync(`${SPEC_DIR}${provenance.specPath}`, 'utf8')) as OpenApiSpec;

  it(`every consumed operation exists in the pinned ${provenance.pinnedVersion} spec`, () => {
    const violations = checkSlskdSpec(spec, SLSKD_CONSUMED_OPERATIONS);
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });

  it('matches consumed operations when the spec templates the version as {version}', () => {
    // slskd's newer OpenAPI emits `/api/v{version}/…` instead of the literal `/api/v0/…`; the
    // runtime endpoint is unchanged, so this must not read as drift.
    const versioned = {
      paths: Object.fromEntries(
        Object.entries(spec.paths ?? {}).map(
          ([p, item]) => [p.replace('/api/v0/', '/api/v{version}/'), item] as const,
        ),
      ),
      components: spec.components,
    };
    expect(checkSlskdSpec(versioned, SLSKD_CONSUMED_OPERATIONS)).toEqual([]);
  });

  it('detects a manifest operation the spec does not declare', () => {
    const violations = checkSlskdSpec(spec, [
      {
        method: 'get',
        path: '/api/v0/does-not-exist',
        pathParams: [],
        usedBy: 'negative control',
      },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.problem).toMatch(/path not found/);
  });

  it('detects a consumed query parameter the spec does not declare', () => {
    // The teardown's `?remove=` is as much consumed surface as a path segment: drop it and the
    // two-phase cancel-then-remove silently becomes a single wrong call. Declaring query parameters
    // is only worth anything if their absence is a violation.
    const violations = checkSlskdSpec(spec, [
      {
        method: 'delete',
        path: '/api/v0/transfers/downloads/{username}/{id}',
        pathParams: ['username', 'id'],
        queryParams: ['nonexistent'],
        usedBy: 'negative control',
      },
    ]);
    expect(violations.map((v) => v.problem)).toContain('query parameter "nonexistent" missing');
  });

  it('detects a missing request field', () => {
    const violations = checkSlskdSpec(spec, [
      {
        method: 'post',
        path: '/api/v0/searches',
        pathParams: [],
        requestBody: {
          schema: 'SearchRequest',
          array: false,
          fields: ['searchText', 'nonexistent'],
        },
        usedBy: 'negative control',
      },
    ]);
    expect(violations.map((v) => v.problem)).toContain('request field "nonexistent" missing');
  });
});

/**
 * The manifest's other failure mode. The checks above prove nothing it *declares* has gone missing
 * from slskd; these prove it cannot quietly declare *less* than the adapters use. `DELETE
 * /api/v0/searches/{id}` was consumed for months while absent from the manifest — invisible to the
 * drift job, which is exactly the state this closes structurally rather than by remembering.
 */
describe('the manifest cannot under-declare the consumed surface', () => {
  it('accepts requests whose operations the manifest declares', () => {
    const requests = [
      { method: 'POST', path: '/api/v0/searches', query: {} },
      { method: 'GET', path: '/api/v0/searches/f1e2d3c4/responses', query: {} },
      { method: 'DELETE', path: '/api/v0/searches/f1e2d3c4', query: {} },
      { method: 'GET', path: '/api/v0/transfers/downloads/peer1', query: {} },
      { method: 'DELETE', path: '/api/v0/transfers/downloads/peer1/6a7b8c9d', query: {} },
      { method: 'GET', path: '/api/v0/events', query: {} },
      { method: 'GET', path: '/api/v0/options', query: {} },
    ];

    expect(undeclaredOperations(requests, SLSKD_CONSUMED_OPERATIONS)).toEqual([]);
  });

  it('names a request whose operation the manifest lacks', () => {
    // The queue-position endpoint is the honest control: real slskd surface the *recorder* drives
    // to make a queued fixture, but no adapter consumes it — so it stays out of the manifest, and
    // the day an adapter starts calling it the tier must say so instead of shrugging.
    const requests = [
      { method: 'GET', path: '/api/v0/transfers/downloads/peer1/6a7b8c9d/position', query: {} },
    ];

    expect(undeclaredOperations(requests, SLSKD_CONSUMED_OPERATIONS)).toEqual([
      'GET /api/v0/transfers/downloads/peer1/6a7b8c9d/position',
    ]);
  });

  it('names a query parameter the manifest does not declare', () => {
    // The mirror of the operation check. Without it nothing ever executes the reporting path, so an
    // inverted condition or a misspelled field would leave the guard permanently, silently green —
    // and the contract tier carries no coverage gate to notice.
    const requests = [
      { method: 'GET', path: '/api/v0/events', query: { offset: '0', bogus: '1' } },
    ];

    expect(undeclaredQueryParams(requests, SLSKD_CONSUMED_OPERATIONS)).toEqual([
      'GET /api/v0/events?bogus',
    ]);
  });

  it('accepts the query parameters the manifest does declare', () => {
    const requests: IssuedRequest[] = [
      { method: 'GET', path: '/api/v0/events', query: { offset: '0', limit: '100' } },
      {
        method: 'DELETE',
        path: '/api/v0/transfers/downloads/peer1/abc',
        query: { remove: 'true' },
      },
    ];

    expect(undeclaredQueryParams(requests, SLSKD_CONSUMED_OPERATIONS)).toEqual([]);
  });

  it('reports each undeclared operation once, however many times it is issued', () => {
    const requests = [
      { method: 'PUT', path: '/api/v0/shares', query: {} },
      { method: 'PUT', path: '/api/v0/shares', query: {} },
    ];

    expect(undeclaredOperations(requests, SLSKD_CONSUMED_OPERATIONS)).toEqual([
      'PUT /api/v0/shares',
    ]);
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SLSKD_CONSUMED_OPERATIONS } from './support/slskd-manifest.js';
import { checkSlskdSpec } from './support/spec-compat.js';

/**
 * Pins the consumed-surface manifest against the committed slskd spec snapshot (task 4.3). If the
 * manifest ever names an operation, path parameter, or request field the pinned spec doesn't
 * declare, this fails — the same checker the drift tier runs against newer slskd releases, proven
 * here to hold for the version we build against.
 */

const SPEC_DIR = new URL('./slskd-spec/', import.meta.url).pathname;

describe('slskd consumed surface (pinned snapshot)', () => {
  const provenance = JSON.parse(readFileSync(`${SPEC_DIR}provenance.json`, 'utf8')) as {
    specPath: string;
    pinnedVersion: string;
  };
  const spec = JSON.parse(readFileSync(`${SPEC_DIR}${provenance.specPath}`, 'utf8'));

  it(`every consumed operation exists in the pinned ${provenance.pinnedVersion} spec`, () => {
    const violations = checkSlskdSpec(spec, SLSKD_CONSUMED_OPERATIONS);
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
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

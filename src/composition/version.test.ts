import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readAppVersion } from './version.js';

describe('readAppVersion', () => {
  it('returns the version from the repo package.json', () => {
    const pkgPath = fileURLToPath(new URL('../../package.json', import.meta.url));
    const expected = (JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string }).version;

    expect(readAppVersion()).toBe(expected);
  });

  it('returns a semantic version string', () => {
    expect(readAppVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});

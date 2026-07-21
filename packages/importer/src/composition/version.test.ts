import { describe, expect, it } from 'vitest';
import { readAppVersion } from './version.js';

describe('readAppVersion', () => {
  it('reads a semver version from package.json', () => {
    expect(readAppVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});

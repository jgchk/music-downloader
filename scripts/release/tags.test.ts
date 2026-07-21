import { describe, expect, it } from 'vitest';
import { latestReleaseVersion } from './tags.ts';

describe('latestReleaseVersion', () => {
  it('picks the highest semver among release tags', () => {
    expect(latestReleaseVersion(['v2.4.2', 'v2.5.1', 'v2.5.0'])).toBe('2.5.1');
  });

  it('orders numerically, not lexicographically', () => {
    expect(latestReleaseVersion(['v2.9.0', 'v2.10.0'])).toBe('2.10.0');
  });

  it('is unmoved by a foreign lineage of lower tags (the merged importer history)', () => {
    expect(latestReleaseVersion(['v0.1.8', 'v0.1.7', 'v2.5.1'])).toBe('2.5.1');
  });

  it('ignores tags that are not plain vX.Y.Z releases', () => {
    expect(latestReleaseVersion(['v2.5.1', 'v3.0.0-rc.1', 'vNext', 'v2'])).toBe('2.5.1');
  });

  it('throws when no release tag exists (a broken checkout, not a first release)', () => {
    expect(() => latestReleaseVersion(['vNext'])).toThrow(/no v\*/);
  });
});

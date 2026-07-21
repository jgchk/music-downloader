import { describe, expect, it } from 'vitest';
import config from '../../eslint.config.js';

/**
 * The module-boundary rules (module-architecture spec) are enforced by `import/no-restricted-paths`
 * in the root eslint config, which the gate runs on every commit. This suite pins the config shape
 * so the boundary zones cannot be silently dropped or loosened: each scenario below corresponds to
 * a spec scenario whose enforcement lives in lint.
 */

interface Zone {
  readonly target: string;
  readonly from: string;
  readonly except?: readonly string[];
}

function zones(): readonly Zone[] {
  const entry = (config as readonly Record<string, unknown>[]).find(
    (item) =>
      typeof item === 'object' &&
      'rules' in item &&
      (item.rules as Record<string, unknown>)['import/no-restricted-paths'] !== undefined,
  );
  expect(entry).toBeDefined();
  const rule = (entry as { rules: Record<string, unknown> }).rules[
    'import/no-restricted-paths'
  ] as [string, { zones: readonly Zone[] }];
  expect(rule[0]).toBe('error');
  return rule[1].zones;
}

function hasZone(list: readonly Zone[], target: string, from: string): boolean {
  return list.some((zone) => zone.target === target && zone.from === from);
}

describe('module boundary lint zones', () => {
  it('forbids each module from importing its sibling', () => {
    const all = zones();
    expect(hasZone(all, './packages/downloader', './packages/importer')).toBe(true);
    expect(hasZone(all, './packages/importer', './packages/downloader')).toBe(true);
  });

  it('lets the web interface package reach a module only through its facade', () => {
    const all = zones();
    for (const pkg of ['downloader', 'importer']) {
      const zone = all.find(
        (candidate) =>
          candidate.target === './packages/web' && candidate.from === `./packages/${pkg}/src`,
      );
      expect(zone).toBeDefined();
      expect(zone?.except).toEqual(['./facade']);
    }
  });

  it('keeps the facade above application and domain only, per package', () => {
    const all = zones();
    for (const pkg of ['downloader', 'importer']) {
      const src = `./packages/${pkg}/src`;
      // Inner layers never reach outward to the facade…
      expect(hasZone(all, `${src}/domain`, `${src}/facade`)).toBe(true);
      expect(hasZone(all, `${src}/application`, `${src}/facade`)).toBe(true);
      expect(hasZone(all, `${src}/adapters`, `${src}/facade`)).toBe(true);
      // …and the facade never reaches adapters, interfaces, or composition.
      expect(hasZone(all, `${src}/facade`, `${src}/adapters`)).toBe(true);
      expect(hasZone(all, `${src}/facade`, `${src}/interfaces`)).toBe(true);
      expect(hasZone(all, `${src}/facade`, `${src}/composition`)).toBe(true);
    }
  });

  it('keeps the dependency rule intact per package', () => {
    const all = zones();
    for (const pkg of ['downloader', 'importer']) {
      const src = `./packages/${pkg}/src`;
      expect(hasZone(all, `${src}/domain`, `${src}/application`)).toBe(true);
      expect(hasZone(all, `${src}/application`, `${src}/adapters`)).toBe(true);
      expect(hasZone(all, `${src}/interfaces`, `${src}/composition`)).toBe(true);
    }
  });

  it('keeps each module package importable only via its facade entry (package exports)', async () => {
    for (const pkg of ['downloader', 'importer']) {
      const manifest = (await import(`../../packages/${pkg}/package.json`, {
        with: { type: 'json' },
      })) as { default: { exports: Record<string, string> } };
      expect(manifest.default.exports).toEqual({ '.': './src/facade/index.ts' });
    }
  });
});

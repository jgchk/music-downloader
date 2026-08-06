import { readdirSync } from 'node:fs';
import path from 'node:path';
import { ESLint } from 'eslint';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * The gate's own reach, pinned (module-architecture: "Every first-party source tier is inside the
 * lint and typecheck gates"). Both enforcement claims are only as good as their coverage, and
 * coverage is exactly the thing that erodes silently — a new tier lands, nobody notices it is in
 * neither a tsconfig nor the lint run, and the rules stop applying to it without a single failure.
 * These two scenarios fail *naming the uncovered file* instead.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

/** Generated output, third-party trees, and the Python bridge tier — not first-party TS sources. */
const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'coverage',
  'build',
  '.svelte-kit',
  '.venv',
  '.e2e-tmp',
  '.git',
  '.jj',
  'bridge',
  '__pycache__',
]);

function firstPartySources(directory = REPO_ROOT): string[] {
  const found: string[] = [];
  const entries = readdirSync(directory, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      found.push(...firstPartySources(full));
    } else if (
      (entry.name.endsWith('.ts') || entry.name.endsWith('.svelte')) &&
      !entry.name.endsWith('.d.ts')
    ) {
      found.push(full);
    }
  }
  return found;
}

/** Every tsconfig in the repo, discovered rather than listed, so a new project counts immediately. */
function projectConfigs(directory = REPO_ROOT): string[] {
  const found: string[] = [];
  const entries = readdirSync(directory, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      found.push(...projectConfigs(full));
    } else if (entry.name === 'tsconfig.json') {
      found.push(full);
    }
  }
  return found;
}

function claimedByAnyProject(): Set<string> {
  const claimed = new Set<string>();
  for (const configPath of projectConfigs()) {
    const parsed = ts.getParsedCommandLineOfConfigFile(
      configPath,
      {},
      {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic: () => {},
      },
    );
    const fileNames = parsed?.fileNames ?? [];
    for (const fileName of fileNames) claimed.add(path.resolve(fileName));
  }
  return claimed;
}

/** The project root `svelte-check --tsconfig` runs over — the second half of the typecheck gate. */
const SVELTE_CHECK_ROOT = path.join(REPO_ROOT, 'packages/web/src');

describe('gate coverage', () => {
  it('typechecks every first-party TypeScript source — each one is claimed by some tsconfig', () => {
    const claimed = claimedByAnyProject();
    const orphans = firstPartySources()
      .filter((file) => file.endsWith('.ts'))
      .filter((file) => !claimed.has(file));

    expect(orphans.map((file) => path.relative(REPO_ROOT, file))).toEqual([]);
  });

  it('typechecks every component — `tsc` cannot claim .svelte, so svelte-check must reach them all', () => {
    // `ts.getParsedCommandLineOfConfigFile` never lists a `.svelte` file: the compiler does not know
    // the extension. Components are typechecked by the `web` lane's `svelte-check --tsconfig`
    // instead, whose reach is its project root — so the coverage question for them is whether any
    // component has escaped that root.
    const strays = firstPartySources()
      .filter((file) => file.endsWith('.svelte'))
      .filter((file) => !file.startsWith(`${SVELTE_CHECK_ROOT}${path.sep}`));

    expect(strays.map((file) => path.relative(REPO_ROOT, file))).toEqual([]);
  });

  it('lints every first-party source — none is excluded by the eslint ignores', async () => {
    const eslint = new ESLint({ cwd: REPO_ROOT });
    const sources = firstPartySources();

    const ignored = await Promise.all(
      sources.map(async (file) => ((await eslint.isPathIgnored(file)) ? file : null)),
    );

    expect(
      ignored.filter((file) => file !== null).map((file) => path.relative(REPO_ROOT, file)),
    ).toEqual([]);
  });
});

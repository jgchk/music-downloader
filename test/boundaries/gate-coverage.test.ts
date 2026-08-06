import { readFileSync, readdirSync } from 'node:fs';
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

/**
 * Every tier the walk must reach. Deliberately hand-listed, unlike everything else here: the three
 * scenarios below are all `expect(<filtered list>).toEqual([])`, so a walk that discovers NOTHING
 * passes them all. That is not hypothetical — narrowing `REPO_ROOT`, or adding one name to
 * `SKIPPED_DIRECTORIES`, silently shrinks the checked set while every assertion stays green. This
 * floor turns an empty or truncated discovery into a failure, so the guard cannot erode the same
 * silent way it exists to prevent.
 */
const REQUIRED_TIERS = [
  'packages/downloader/src',
  'packages/downloader/scripts',
  'packages/downloader/test/contract',
  'packages/importer/src',
  'packages/importer/scripts',
  'packages/importer/test/contract',
  'packages/web/src',
  'scripts',
  'test/boundaries',
  'test/e2e',
];

/**
 * The projects some typecheck script actually runs. Membership in a tsconfig is only half the
 * claim: `typecheck:tiers` is a hand-maintained list of `-p` flags, so a tier that lands with its
 * own tsconfig and no `package.json` edit is claimed by a project nobody ever invokes.
 */
function projectsUnderTheGate(): ReadonlySet<string> {
  const manifest = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  const scripts = [manifest.scripts.typecheck, manifest.scripts['typecheck:tiers']].join(' ');
  const invoked = new Set<string>();
  for (const [, project] of scripts.matchAll(/-p\s+(\S+)/g)) {
    // The capture group is present whenever the pattern matches; narrow rather than assert.
    if (project !== undefined) invoked.add(path.resolve(REPO_ROOT, project));
  }
  // The web project is driven by `check:svelte`'s `svelte-check --tsconfig`, not by a `tsc -p`.
  invoked.add(path.join(REPO_ROOT, 'packages/web/tsconfig.json'));
  return invoked;
}

describe('gate coverage', () => {
  it('reaches every tier, so the scenarios below cannot pass over an empty set', () => {
    const sources = firstPartySources().map((file) => path.relative(REPO_ROOT, file));
    const unreached = REQUIRED_TIERS.filter((tier) =>
      sources.every((file) => !file.startsWith(`${tier}${path.sep}`)),
    );

    expect(unreached).toEqual([]);
    expect(sources.filter((file) => file.endsWith('.svelte')).length).toBeGreaterThan(0);
  });

  it('runs every project it discovers — a tsconfig nobody invokes typechecks nothing', () => {
    const invoked = projectsUnderTheGate();
    const unwired = projectConfigs().filter((config) => !invoked.has(config));

    expect(unwired.map((file) => path.relative(REPO_ROOT, file))).toEqual([]);
  });

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

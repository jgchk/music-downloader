import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ESLint } from 'eslint';
import ts from 'typescript';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * The gate's own reach, pinned (module-architecture: "Every first-party source tier is inside the
 * lint and typecheck gates"). Both enforcement claims are only as good as their coverage, and
 * coverage is exactly the thing that erodes silently — a new tier lands, nobody notices it is in
 * neither a tsconfig nor the lint run, and the rules stop applying to it without a single failure.
 * These scenarios fail *naming the uncovered file* instead.
 *
 * A guard against silent erosion must not erode silently itself, so three of its own failure modes
 * are pinned here too: a skip that prunes more than it names, a config diagnostic read as "this
 * project claims nothing", and a read of output a concurrent `pnpm check` lane generates.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

/**
 * Generated output and third-party trees, matched by name because these names are reserved by the
 * tools that produce them — no first-party source directory is ever called one of them. Skipping
 * them is also what keeps this walk deterministic: every one is written by some other `pnpm check`
 * lane while this one runs.
 */
const GENERATED_DIRECTORY_NAMES = new Set([
  'node_modules',
  'dist',
  'coverage',
  'build',
  '.svelte-kit',
  '.venv',
  '.e2e-tmp',
  '.git',
  '.jj',
  '__pycache__',
]);

/**
 * First-party trees that are deliberately outside the TypeScript gates, matched by *anchored path*.
 * `bridge` used to live in the name set above, where it also pruned
 * `packages/importer/src/adapters/beets/bridge` — production source — out of the coverage claim.
 * A skip that means one directory must name that directory, not its basename.
 */
const SKIPPED_PATHS = new Set([
  // The Python bridge test tier: unittest + coverage.py, gated by `pnpm test:bridge`, not by tsc.
  'packages/importer/test/bridge',
]);

/** Repo-relative, `/`-separated — the form skip entries and failure messages are written in. */
function repoRelative(absolute: string): string {
  const relative = path.relative(REPO_ROOT, absolute);
  return relative.startsWith('..') ? absolute : relative.split(path.sep).join('/');
}

function isSkippedDirectory(absolute: string): boolean {
  return (
    GENERATED_DIRECTORY_NAMES.has(path.basename(absolute)) ||
    SKIPPED_PATHS.has(repoRelative(absolute))
  );
}

/** Every directory the walk descends into, root first — the exact reach of the discovery below. */
function walkedDirectories(from: string = REPO_ROOT): string[] {
  const found = [from];
  const entries = readdirSync(from, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const full = path.join(from, entry.name);
    if (isSkippedDirectory(full)) continue;
    found.push(...walkedDirectories(full));
  }
  return found;
}

function filesInWalk(isMatch: (fileName: string) => boolean): string[] {
  const found: string[] = [];
  const directories = walkedDirectories();
  for (const directory of directories) {
    const entries = readdirSync(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() && isMatch(entry.name)) found.push(path.join(directory, entry.name));
    }
  }
  return found;
}

function firstPartySources(): string[] {
  return filesInWalk(
    (fileName) =>
      (fileName.endsWith('.ts') || fileName.endsWith('.svelte')) && !fileName.endsWith('.d.ts'),
  );
}

/** Every tsconfig in the repo, discovered rather than listed, so a new project counts immediately. */
function projectConfigs(): string[] {
  return filesInWalk((fileName) => fileName === 'tsconfig.json');
}

interface ProjectMembership {
  /** Every file the given projects claim, absolute. */
  readonly claimed: ReadonlySet<string>;
  /** Every diagnostic raised while reading a config, each naming its config. */
  readonly problems: readonly string[];
  /** Every file the parse itself read — the configs and everything they `extends`, transitively. */
  readonly readFiles: readonly string[];
}

/**
 * Reads project membership, reporting every config diagnostic instead of swallowing it. A config
 * TypeScript cannot read yields no `fileNames` at all, and a config it cannot parse yields whatever
 * its default include happens to match — either way the membership answer is fiction, and a silent
 * one turns every `toEqual([])` below into a pass. Diagnostics are values here, so the scenario
 * that hits one fails naming the config and the message.
 */
function filesClaimedBy(configPaths: readonly string[]): ProjectMembership {
  const claimed = new Set<string>();
  const problems: string[] = [];
  const readFiles: string[] = [];
  for (const configPath of configPaths) {
    const report = (diagnostic: ts.Diagnostic): void => {
      problems.push(
        `${repoRelative(configPath)}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`,
      );
    };
    const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, {
      ...ts.sys,
      // Every config the parse touches, `extends` targets included, recorded as it is read.
      readFile: (fileName: string): string | undefined => {
        readFiles.push(fileName);
        return ts.sys.readFile(fileName);
      },
      onUnRecoverableConfigFileDiagnostic: report,
    } satisfies ts.ParseConfigFileHost);
    const diagnostics = parsed?.errors ?? [];
    for (const diagnostic of diagnostics) report(diagnostic);
    const fileNames = parsed?.fileNames ?? [];
    for (const fileName of fileNames) claimed.add(path.resolve(fileName));
  }
  return { claimed, problems, readFiles };
}

/** The one project this guard proves by containment rather than by membership — see below. */
const WEB_PROJECT = path.join(REPO_ROOT, 'packages/web/tsconfig.json');

/**
 * The projects whose membership is read from disk. `packages/web/tsconfig.json` is deliberately
 * excluded: it extends `.svelte-kit/tsconfig.json`, which `svelte-kit sync` generates inside the
 * `web` lane while this lane runs. Reading it would make coverage a race — and it is not needed,
 * because the web lane's reach is knowable without it (`WEB_LANE_REACH`).
 */
function gatedProjectConfigs(): string[] {
  return projectConfigs().filter((config) => config !== WEB_PROJECT);
}

/**
 * What the `web` lane's `svelte-check --tsconfig ./tsconfig.json` covers, stated rather than read.
 * `svelte-kit sync` generates that project's `include` from SvelteKit's fixed conventions — the
 * source root, the test roots, and the vite config — so the reach is a property of the framework's
 * layout, not of whether a sibling lane has run yet. Everything the walk finds under these paths is
 * inside the typecheck gate; anything else under `packages/web` must be claimed by a real project.
 * This is the same containment argument the `.svelte` scenario already rests on, applied to the
 * whole lane: `tsc` cannot claim a component, and neither can it claim these without the generated
 * config.
 */
const WEB_LANE_REACH = [
  'packages/web/src',
  'packages/web/test',
  'packages/web/tests',
  'packages/web/vite.config.ts',
];

function isInsideWebLane(file: string): boolean {
  const relative = repoRelative(file);
  return WEB_LANE_REACH.some((entry) => relative === entry || relative.startsWith(`${entry}/`));
}

/**
 * Every tier the walk must reach. Deliberately hand-listed, unlike everything else here: the
 * coverage scenarios are all `expect(<filtered list>).toEqual([])`, so a walk that discovers NOTHING
 * passes them all. That is not hypothetical — narrowing `REPO_ROOT`, or adding one entry to a skip
 * set, silently shrinks the checked set while every assertion stays green. This floor turns an empty
 * or truncated discovery into a failure, so the guard cannot erode the same silent way it exists to
 * prevent. The `packages/web` tiers are listed for a second reason: they are the ones proven by
 * containment in `WEB_LANE_REACH`, and containment over nothing is free.
 */
const REQUIRED_TIERS = [
  'packages/downloader/src',
  'packages/downloader/scripts',
  'packages/downloader/test/contract',
  'packages/importer/src',
  'packages/importer/scripts',
  'packages/importer/test/contract',
  'packages/web/src',
  'packages/web/test',
  'packages/web/tests',
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

/** Broken configs live outside the repo: a malformed `tsconfig.json` inside it fails other lanes. */
const temporaryRoots: string[] = [];

function temporaryDirectory(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'gate-coverage-'));
  temporaryRoots.push(root);
  return root;
}

describe('gate coverage', () => {
  afterAll(() => {
    for (const root of temporaryRoots) rmSync(root, { recursive: true, force: true });
  });

  it('names a config it cannot parse — a broken project must not read as zero claimed files', () => {
    const configPath = path.join(temporaryDirectory(), 'tsconfig.json');
    writeFileSync(configPath, '{ "compilerOptions": { "strict": true ');

    const { problems } = filesClaimedBy([configPath]);

    expect(problems).not.toEqual([]);
    expect(problems.join('\n')).toContain(repoRelative(configPath));
  });

  it('names a config it cannot read at all — an absent project must not read as zero claimed files', () => {
    const configPath = path.join(temporaryDirectory(), 'absent', 'tsconfig.json');

    const { claimed, problems } = filesClaimedBy([configPath]);

    expect(claimed.size).toBe(0);
    expect(problems.join('\n')).toContain(repoRelative(configPath));
  });

  it('reads no config another lane generates — the answer must not depend on lane order', () => {
    // `pnpm check` fans its lanes out in parallel. Reading a file the `web` lane's `svelte-kit
    // sync` writes makes this guard's verdict a race: run first and the project resolves to
    // nothing (or to a default include), run second and it resolves to the real membership.
    const { claimed, readFiles } = filesClaimedBy(gatedProjectConfigs());
    const generated = [...readFiles, ...claimed].filter((file) =>
      repoRelative(file)
        .split('/')
        .some((segment) => GENERATED_DIRECTORY_NAMES.has(segment)),
    );

    expect(generated.map((file) => repoRelative(file))).toEqual([]);
  });

  it('parses every project it reads without a diagnostic', () => {
    const { problems } = filesClaimedBy(gatedProjectConfigs());

    expect(problems).toEqual([]);
  });

  it('prunes the trees it names and nothing else — a skip must not match by basename', () => {
    const walked = walkedDirectories().map((directory) => repoRelative(directory));

    // Production source that happens to sit in a directory sharing the Python tier's name. A
    // basename skip prunes it, and every coverage scenario here then passes over the hole.
    expect(walked).toContain('packages/importer/src/adapters/beets/bridge');
    // The skips that are meant to skip still do.
    expect(walked).not.toContain('packages/importer/test/bridge');
    expect(walked).not.toContain('node_modules');
    expect(walked).not.toContain('packages/web/.svelte-kit');
    expect(walked).not.toContain('packages/importer/test/bridge/.venv');
  });

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
    const { claimed } = filesClaimedBy(gatedProjectConfigs());
    const orphans = firstPartySources()
      .filter((file) => file.endsWith('.ts'))
      .filter((file) => !claimed.has(file) && !isInsideWebLane(file));

    expect(orphans.map((file) => path.relative(REPO_ROOT, file))).toEqual([]);
  });

  it('typechecks every component — `tsc` cannot claim .svelte, so svelte-check must reach them all', () => {
    // `ts.getParsedCommandLineOfConfigFile` never lists a `.svelte` file: the compiler does not know
    // the extension. Components are typechecked by the `web` lane's `svelte-check --tsconfig`
    // instead — so the coverage question for them is whether any component has escaped that lane's
    // reach.
    const strays = firstPartySources()
      .filter((file) => file.endsWith('.svelte'))
      .filter((file) => !isInsideWebLane(file));

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

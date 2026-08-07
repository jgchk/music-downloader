import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
 * A guard against silent erosion must not erode silently itself, so its own failure modes are
 * pinned in the second describe below, one scenario each: a skip that prunes more than it names, a
 * config diagnostic read as "this project claims nothing", a read of output a concurrent
 * `pnpm check` lane generates, a discovery that finds nothing and so passes every `toEqual([])`, a
 * declared lane reach nothing compares against that lane, and a project credited to a script that
 * no longer names it.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

/**
 * Third-party and tool-owned trees, matched by *name* — and only names whose owning tool reserves
 * them: a package manager's (`node_modules`), a language runtime's (`__pycache__`), or a
 * dot-directory, which no first-party source tree is. Names we picked ourselves (`dist`, `build`,
 * `coverage`) are anchored in `GENERATED_PATHS` instead, because a basename skip prunes every
 * directory sharing the name — a real `scripts/build/` of first-party source included. The scenario
 * 'skips by basename only where a tool owns the name' holds this set to that rule, so the claim is
 * checked rather than asserted in prose.
 */
const GENERATED_DIRECTORY_NAMES = new Set([
  'node_modules',
  '__pycache__',
  '.svelte-kit',
  '.venv',
  '.e2e-tmp',
  // Stryker's sandbox: a full copy of the tree, so every source in it would surface here twice —
  // once as itself and once as an orphan no tsconfig claims.
  '.stryker-tmp',
  '.git',
  '.jj',
]);

/**
 * Generated output whose directory name is ours rather than a tool's, matched by *anchored path*
 * so the name alone prunes nothing. Skipping these is also what keeps the walk deterministic: every
 * one is written by some other `pnpm check` lane while this one runs.
 */
const GENERATED_PATHS = new Set([
  'coverage',
  // Mutation-run output (`pnpm test:mutation`): the JSON report and the incremental cache.
  'reports',
  'packages/downloader/dist',
  'packages/importer/dist',
  'packages/web/build',
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

/** True for anything under a tool-owned name or an anchored generated tree, at any depth. */
function isGeneratedPath(file: string): boolean {
  const relative = repoRelative(file);
  return (
    relative.split('/').some((segment) => GENERATED_DIRECTORY_NAMES.has(segment)) ||
    [...GENERATED_PATHS].some((tree) => relative === tree || relative.startsWith(`${tree}/`))
  );
}

function isSkippedDirectory(absolute: string): boolean {
  return isGeneratedPath(absolute) || SKIPPED_PATHS.has(repoRelative(absolute));
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

const WEB_PACKAGE = path.join(REPO_ROOT, 'packages/web');

/** The one project this guard proves by containment rather than by membership — see below. */
const WEB_PROJECT = path.join(WEB_PACKAGE, 'tsconfig.json');

/** The project `svelte-kit sync` writes; `packages/web/tsconfig.json` extends it. */
const GENERATED_WEB_PROJECT = path.join(WEB_PACKAGE, '.svelte-kit/tsconfig.json');

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
 * What the `web` lane's `svelte-check --tsconfig ./tsconfig.json` covers, declared here instead of
 * parsed at coverage time — parsing the generated project as part of the coverage answer is what
 * would make this lane's verdict depend on whether the `web` lane has run yet.
 *
 * A declaration nothing compares against reality is only a claim, and a SvelteKit bump that drops
 * `../test/**` from the generated `include` would move a whole contract tier out of the typecheck
 * gate while every scenario here stayed green. So 'declares the web lane exactly as the generated
 * project defines it' re-derives both lists from that config *whenever it is on disk* and fails on
 * any drift; absence is never a failure there, which is what keeps the race gone.
 *
 * `WEB_LANE_EXCLUSIONS` is load-bearing, not bookkeeping. The generated config excludes
 * `../src/service-worker.js`, `../src/service-worker.ts`, `../src/service-worker.d.ts` and the
 * matching `../src/service-worker/` subtrees — so a `packages/web/src/service-worker.ts` would be
 * claimed by no project *and* excluded by the web lane, i.e. typechecked by nothing. Subtracting
 * the exclusions is what makes such a file surface as an orphan instead of passing silently.
 */
const WEB_LANE_REACH = [
  'packages/web/src',
  'packages/web/test',
  'packages/web/tests',
  'packages/web/vite.config.js',
  'packages/web/vite.config.ts',
];

const WEB_LANE_EXCLUSIONS = [
  'packages/web/src/service-worker',
  'packages/web/src/service-worker.d.ts',
  'packages/web/src/service-worker.js',
  'packages/web/src/service-worker.ts',
];

function isInsideWebLane(file: string): boolean {
  const relative = repoRelative(file);
  const isUnder = (entry: string): boolean =>
    relative === entry || relative.startsWith(`${entry}/`);
  return (
    WEB_LANE_REACH.some((entry) => isUnder(entry)) &&
    WEB_LANE_EXCLUSIONS.every((entry) => !isUnder(entry))
  );
}

/** Code-unit order, so the declarations above read the way this sorts them. */
function byPath(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/**
 * The repo-relative roots a set of generated `include`/`exclude` patterns names: each pattern
 * resolved against the generated config's own directory, then cut at its first glob segment. Sorted,
 * so the declarations above can be compared to it directly. Patterns naming generated trees — the
 * config's own `types/`, its ambient declarations, `node_modules` — reach nothing this walk can see,
 * so they drop out rather than becoming entries no source could ever match.
 */
function webLaneRootsFrom(patterns: readonly string[]): string[] {
  const roots = new Set<string>();
  for (const pattern of patterns) {
    const resolved = repoRelative(path.resolve(path.dirname(GENERATED_WEB_PROJECT), pattern));
    const segments = resolved.split('/');
    const globAt = segments.findIndex((segment) => segment.includes('*'));
    const root = (globAt === -1 ? segments : segments.slice(0, globAt)).join('/');
    if (root === '' || isGeneratedPath(path.join(REPO_ROOT, root))) continue;
    roots.add(root);
  }
  return [...roots].toSorted(byPath);
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

/** A package's `scripts` block. Taken as a parameter below so a scenario can mangle one. */
type ScriptReader = (packageDirectory: string) => Record<string, string | undefined>;

const scriptsOf: ScriptReader = (packageDirectory) => {
  const manifest = JSON.parse(
    readFileSync(path.join(packageDirectory, 'package.json'), 'utf8'),
  ) as { scripts?: Record<string, string> };
  return manifest.scripts ?? {};
};

/** Every project a command names — `tsc -p` and `svelte-check --tsconfig` alike — resolved against
 * the package whose script runs it. */
function projectsNamedIn(script: string, packageDirectory: string): string[] {
  const found: string[] = [];
  for (const [, project] of script.matchAll(/(?:^|\s)(?:-p|--tsconfig)\s+(\S+)/g)) {
    // The capture group is present whenever the pattern matches; narrow rather than assert.
    if (project !== undefined) found.push(path.resolve(packageDirectory, project));
  }
  return found;
}

/**
 * The projects some typecheck script actually runs. Membership in a tsconfig is only half the
 * claim: `typecheck:tiers` is a hand-maintained list of `-p` flags, so a tier that lands with its
 * own tsconfig and no `package.json` edit is claimed by a project nobody ever invokes.
 *
 * The web project is the awkward one — it is typechecked by `svelte-check --tsconfig` in a second
 * manifest, so BOTH links are read rather than assumed: the root typecheck must still delegate to
 * `packages/web run check:svelte`, and that script must still name the project. Hard-asserting the
 * web project here (as this once did) meant either link could break with the guard still reporting
 * full coverage — the exact silent erosion it exists to catch.
 */
function projectsUnderTheGate(readScripts: ScriptReader = scriptsOf): ReadonlySet<string> {
  const rootScripts = readScripts(REPO_ROOT);
  const rootTypecheck = [rootScripts.typecheck, rootScripts['typecheck:tiers']].join(' ');
  const invoked = projectsNamedIn(rootTypecheck, REPO_ROOT);
  if (/--dir\s+packages\/web\s+run\s+check:svelte/.test(rootTypecheck)) {
    const checkSvelte = readScripts(WEB_PACKAGE)['check:svelte'] ?? '';
    invoked.push(...projectsNamedIn(checkSvelte, WEB_PACKAGE));
  }
  return new Set(invoked);
}

/** Broken configs live outside the repo: a malformed `tsconfig.json` inside it fails other lanes. */
const temporaryRoots: string[] = [];

function temporaryDirectory(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'gate-coverage-'));
  temporaryRoots.push(root);
  return root;
}

describe('gate coverage', () => {
  it('parses every project it reads without a diagnostic', () => {
    const { problems } = filesClaimedBy(gatedProjectConfigs());

    expect(problems).toEqual([]);
  });

  it('runs every project it discovers — a tsconfig nobody invokes typechecks nothing', () => {
    const invoked = projectsUnderTheGate();
    const unwired = projectConfigs().filter((config) => !invoked.has(config));

    expect(unwired.map((file) => repoRelative(file))).toEqual([]);
  });

  it('typechecks every first-party TypeScript source — each one is claimed by some tsconfig', () => {
    const { claimed } = filesClaimedBy(gatedProjectConfigs());
    const orphans = firstPartySources()
      .filter((file) => file.endsWith('.ts'))
      .filter((file) => !claimed.has(file) && !isInsideWebLane(file));

    expect(orphans.map((file) => repoRelative(file))).toEqual([]);
  });

  it('typechecks every component — `tsc` cannot claim .svelte, so svelte-check must reach them all', () => {
    // `ts.getParsedCommandLineOfConfigFile` never lists a `.svelte` file: the compiler does not know
    // the extension. Components are typechecked by the `web` lane's `svelte-check --tsconfig`
    // instead — so the coverage question for them is whether any component has escaped that lane's
    // reach.
    const strays = firstPartySources()
      .filter((file) => file.endsWith('.svelte'))
      .filter((file) => !isInsideWebLane(file));

    expect(strays.map((file) => repoRelative(file))).toEqual([]);
  });

  it('lints every first-party source — none is excluded by the eslint ignores', async () => {
    const eslint = new ESLint({ cwd: REPO_ROOT });
    const sources = firstPartySources();

    const ignored = await Promise.all(
      sources.map(async (file) => ((await eslint.isPathIgnored(file)) ? file : null)),
    );

    expect(ignored.filter((file) => file !== null).map((file) => repoRelative(file))).toEqual([]);
  });
});

describe('gate coverage: the guard itself', () => {
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
    const generated = [...readFiles, ...claimed].filter((file) => isGeneratedPath(file));

    expect(generated.map((file) => repoRelative(file))).toEqual([]);
  });

  it('prunes the trees it names and nothing else — a skip must not match by basename', () => {
    const walked = walkedDirectories().map((directory) => repoRelative(directory));

    // Production source that happens to sit in a directory sharing the Python tier's name. A
    // basename skip prunes it, and every coverage scenario here then passes over the hole.
    expect(walked).toContain('packages/importer/src/adapters/beets/bridge');
    // The skips that are meant to skip still do — by name at depth, and by anchored path.
    expect(walked).not.toContain('packages/importer/test/bridge');
    expect(walked).not.toContain('node_modules');
    expect(walked).not.toContain('packages/web/.svelte-kit');
    expect(walked).not.toContain('packages/downloader/dist');
  });

  it("descends into first-party source that shares a build tool's directory name", () => {
    // The hazard anchoring exists to remove, exercised on a tree of this guard's own making: a
    // `build` (or `dist`, or `coverage`) directory holding real source must be walked, not pruned.
    const root = temporaryDirectory();
    mkdirSync(path.join(root, 'scripts', 'build'), { recursive: true });

    expect(walkedDirectories(root)).toContain(path.join(root, 'scripts', 'build'));
  });

  it('skips by basename only where a tool owns the name — every other skip is anchored', () => {
    // Dot-directories and the two names a package manager / language runtime reserve. Anything else
    // is a name we chose, and a name we chose can collide with first-party source.
    const chosenByUs = [...GENERATED_DIRECTORY_NAMES].filter(
      (name) => !name.startsWith('.') && name !== 'node_modules' && name !== '__pycache__',
    );

    expect(chosenByUs).toEqual([]);
  });

  it('reaches every tier, so the coverage scenarios cannot pass over an empty set', () => {
    const sources = firstPartySources().map((file) => repoRelative(file));
    const unreached = REQUIRED_TIERS.filter((tier) =>
      sources.every((file) => !file.startsWith(`${tier}/`)),
    );

    expect(unreached).toEqual([]);
    expect(sources.filter((file) => file.endsWith('.svelte')).length).toBeGreaterThan(0);
  });

  it('holds a web source outside the lane when the generated project excludes it', () => {
    // Inside `WEB_LANE_REACH`, claimed by no project, and excluded by the web lane: typechecked by
    // nothing. It must read as outside the lane so the orphan scenario names it.
    const serviceWorker = path.join(REPO_ROOT, 'packages/web/src/service-worker.ts');

    expect(isInsideWebLane(serviceWorker)).toBe(false);
    expect(isInsideWebLane(path.join(REPO_ROOT, 'packages/web/src/app.ts'))).toBe(true);
  });

  it('declares the web lane exactly as the generated project defines it', (ctx) => {
    // Read only to check the declaration, never to compute coverage — so absence (a cold clone
    // whose `web` lane has not run) skips instead of failing, and no verdict depends on lane order.
    // `readConfigFile` reports an unreadable or half-written file as a value rather than throwing.
    const read = ts.readConfigFile(GENERATED_WEB_PROJECT, ts.sys.readFile);
    if (read.error !== undefined)
      ctx.skip('`svelte-kit sync` has not written the generated project yet');
    const generated = read.config as { include?: string[]; exclude?: string[] };

    expect(webLaneRootsFrom(generated.include ?? [])).toEqual(WEB_LANE_REACH);
    expect(webLaneRootsFrom(generated.exclude ?? [])).toEqual(WEB_LANE_EXCLUSIONS);
  });

  it('credits the web project only while `check:svelte` still names it', () => {
    // The manifest read through a reader that drops the `--tsconfig` flag, so the erosion is
    // exercised without leaving a mangled `package.json` behind. That the real script still names
    // the project is the repo-level 'runs every project it discovers' claim, not this one.
    const withoutTheFlag: ScriptReader = (packageDirectory) =>
      packageDirectory === WEB_PACKAGE
        ? { ...scriptsOf(packageDirectory), 'check:svelte': 'svelte-kit sync && svelte-check' }
        : scriptsOf(packageDirectory);

    const credited = [...projectsUnderTheGate(withoutTheFlag)].map((file) => repoRelative(file));

    expect(credited).not.toContain('packages/web/tsconfig.json');
  });

  it('credits the web project only while the root typecheck still delegates to that script', () => {
    // The second link: `svelte-check` runs one manifest away, so a root typecheck that stops
    // invoking it takes the whole web lane out of the gate however well `check:svelte` reads.
    const withoutTheDelegation: ScriptReader = (packageDirectory) =>
      packageDirectory === REPO_ROOT
        ? {
            ...scriptsOf(packageDirectory),
            typecheck: 'tsc --noEmit -p packages/downloader/tsconfig.json',
          }
        : scriptsOf(packageDirectory);

    const credited = [...projectsUnderTheGate(withoutTheDelegation)].map((file) =>
      repoRelative(file),
    );

    expect(credited).not.toContain('packages/web/tsconfig.json');
  });
});

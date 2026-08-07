import { globSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import mutationSuiteConfig from '../../vitest.mutation.config.ts';
import { REPORT_PATH } from '../../scripts/mutation/report-model.ts';
import strykerConfig from '../../stryker.config.mjs';

/**
 * The mutation gate's reach, pinned (mutation-testing: "Scope covers both bounded-context packages
 * end to end"). Mutation testing is the instrument that measures whether tests *detect* faults
 * rather than merely execute lines, so a hole in its scope is invisible in exactly the way the
 * 100% line-coverage gate is: everything stays green while a whole tree stops being audited.
 *
 * Four claims are held here, each one a way the gate could quietly stop meaning what it says:
 *
 *   • Scope completeness — every production TypeScript source in the two context packages is
 *     mutated. A new layer, a renamed directory, or a tightened glob surfaces here by name.
 *   • The named exclusion — the web package is out of scope on the record, with its deferred-item
 *     pointer, rather than by omission (a partial gate that reads as a whole one is worse).
 *   • The latency budget — `pnpm test:mutation` exists and the commit gate does NOT run it
 *     (quality-gates: minutes-order analysis lives in CI, runnable locally on demand).
 *   • The waiver doctrine — every arid suppression carries a written justification, held to the
 *     same burden as an `any`. An unjustified suppression is a defect, and a suppression the
 *     machine never reads is the one that rots.
 *
 * As in `gate-coverage.test.ts`, most scenarios are `expect(<filtered list>).toEqual([])`, which a
 * discovery finding NOTHING would pass. The floor scenario exists so that cannot happen silently.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

/** Code-unit order, matching how `gate-coverage.test.ts` sorts the paths it reports. */
function byPath(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** Repo-relative, `/`-separated — the form the config globs and failure messages are written in. */
function toPosix(relative: string): string {
  return relative.split(path.sep).join('/');
}

/**
 * The files a set of globs resolves to, read off the real tree rather than re-implemented. Stryker
 * negations are handled by resolving them the same way and subtracting, so no glob semantics are
 * duplicated here — a pattern this test mis-parsed would be a second source of truth about scope.
 */
function filesMatching(patterns: readonly string[]): Set<string> {
  const matched = patterns.flatMap((pattern) => globSync(pattern, { cwd: REPO_ROOT }));
  return new Set(matched.map((entry) => toPosix(entry)));
}

/**
 * Stryker types a config object as `PartialStrykerOptions`, where every field — `mutate` included —
 * is optional. It is narrowed here rather than asserted through: a config that lost its `mutate`
 * would arrive as an empty scope, which the floor scenario below fails on by name instead of
 * quietly satisfying every `toEqual([])`.
 */
const mutatePatterns: readonly string[] = (strykerConfig.mutate ?? []).filter(
  (pattern) => pattern !== undefined,
);

const includePatterns = mutatePatterns.filter((pattern) => !pattern.startsWith('!'));
const excludePatterns = mutatePatterns
  .filter((pattern) => pattern.startsWith('!'))
  .map((pattern) => pattern.slice(1));

/** Exactly what Stryker will mutate, derived from the shipped config. */
function mutatedFiles(): string[] {
  const excluded = filesMatching(excludePatterns);
  return [...filesMatching(includePatterns)].filter((file) => !excluded.has(file)).toSorted(byPath);
}

/**
 * Both scans are hoisted to module scope. They were being called inside `.filter()` predicates,
 * which re-globbed both source trees once per file — ~1.2s added to every `pnpm check`, on a gate
 * whose whole budget is seconds-order.
 */
const MUTATED = mutatedFiles();
const MUTATED_SET = new Set(MUTATED);

const CONTEXT_SOURCE_TREES = ['packages/downloader/src', 'packages/importer/src'];

/**
 * Every production TypeScript source in the two context packages — the answer scope is compared
 * against, derived from the tree instead of from the config so the two can disagree.
 *
 * Test code (`*.test.ts`) and the in-`src` fixture builders are not production and are not mutated;
 * `bridge.py` is the Python tier, audited by `pnpm test:bridge` at its own 100% floor.
 */
function productionSources(): string[] {
  return [...filesMatching(CONTEXT_SOURCE_TREES.map((tree) => `${tree}/**/*.ts`))]
    .filter((file) => !file.endsWith('.test.ts') && !file.includes('/__fixtures__/'))
    .toSorted(byPath);
}

const PRODUCTION = productionSources();
const PRODUCTION_SET = new Set(PRODUCTION);

/**
 * The lanes `pnpm check` actually runs, read from the one place that defines them (`check.sh`
 * declares the list for both its modes). Asserting on the script text is what makes "the commit
 * gate does not run mutation testing" a checked claim rather than a promise in a design doc.
 */
function commitGateText(): string {
  return readFileSync(path.join(REPO_ROOT, 'scripts/check.sh'), 'utf8');
}

function rootScripts(): Record<string, string | undefined> {
  const manifest = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };
  return manifest.scripts ?? {};
}

/**
 * Every Stryker suppression comment in the mutated tree, with its file, line, and text. Stryker's
 * form is `// Stryker disable next-line <mutators>: <reason>`; the reason after the colon is the
 * whole point, and it is optional as far as Stryker is concerned — which is why it is checked here.
 */
interface Suppression {
  readonly location: string;
  readonly text: string;
}

/**
 * Only `disable` directives are waivers. `// Stryker restore all` ends a disabled region and takes
 * no `: reason` clause, so demanding a justification from one would report a legitimate comment as
 * a defect.
 */
const SUPPRESSION_PATTERN = /Stryker\s+disable\b[^\n]*/g;

function suppressions(): Suppression[] {
  const found: Suppression[] = [];
  for (const file of MUTATED) {
    const lines = readFileSync(path.join(REPO_ROOT, file), 'utf8').split('\n');
    for (const [index, line] of lines.entries()) {
      for (const [text] of line.matchAll(SUPPRESSION_PATTERN)) {
        found.push({ location: `${file}:${index + 1}`, text });
      }
    }
  }
  return found;
}

/**
 * Short enough that no real reason trips it, long enough that a colon and a shrug does. Named
 * because an unexplained number carrying a whole policy is the thing this file exists to prevent.
 */
const MIN_JUSTIFICATION_CHARS = 12;

/** A justification is text after the colon that says something — not a colon and a shrug. */
function isJustified(text: string): boolean {
  const [, ...rest] = text.split(':');
  const reason = rest.join(':').trim();
  return reason.length >= MIN_JUSTIFICATION_CHARS;
}

describe('mutation scope', () => {
  it('mutates every production source in both context packages — no tree is silently out of scope', () => {
    const unmutated = PRODUCTION.filter((file) => !MUTATED_SET.has(file));

    expect(unmutated).toEqual([]);
  });

  it('mutates nothing but production source — test code and fixtures are not production', () => {
    const strays = MUTATED.filter((file) => !PRODUCTION_SET.has(file));

    expect(strays).toEqual([]);
  });

  it('reaches real code, so the scope scenarios cannot pass over an empty set', () => {
    const mutated = MUTATED;

    // A floor per package, and the two deciders by name: they are the code this gate most exists
    // to audit, and a scope that lost either of them while staying non-empty would pass above.
    expect(
      mutated.filter((file) => file.startsWith('packages/downloader/src/')).length,
    ).toBeGreaterThan(50);
    expect(
      mutated.filter((file) => file.startsWith('packages/importer/src/')).length,
    ).toBeGreaterThan(25);
    expect(mutated.some((file) => file.includes('/domain/acquisition/'))).toBe(true);
    expect(mutated.some((file) => file.includes('/domain/import/'))).toBe(true);
  });

  it('excludes by named pattern only — no directory-level exclusion inside the covered packages', () => {
    // The spec forbids excluding a directory of the covered packages (composition roots included):
    // wiring is handled by per-site suppression so non-arid logic hiding in it stays observed.
    // These two negations are the whole allowlist, and both name non-production code.
    expect(excludePatterns.toSorted(byPath)).toEqual([
      'packages/*/src/**/*.test.ts',
      'packages/*/src/**/__fixtures__/**',
    ]);
  });

  it('names the web package as excluded rather than omitting it silently', () => {
    const config = readFileSync(path.join(REPO_ROOT, 'stryker.config.mjs'), 'utf8');

    // The behavioural half: web really is out of scope. The config's prose is deliberately NOT
    // asserted — a wording match can only fail on a reword, and its only fix is to paste the word
    // back, which is the appeasement shape. The named-exclusion claim is carried by the config
    // review and by `tasks.md` 4.2, not by a regex over a comment.
    expect(config).toContain('packages/web');
    expect(MUTATED.filter((file) => file.startsWith('packages/web/'))).toEqual([]);
  });
});

describe('mutation gate placement', () => {
  it('is runnable locally on demand, as a real Stryker invocation', () => {
    // Not just "the key exists": `"test:mutation": "echo todo"` would satisfy that, and so would a
    // script that silently stopped running Stryker. `--incremental` is the local-only half of D4a.
    const script = rootScripts()['test:mutation'] ?? '';

    expect(script).toMatch(/stryker run/);
    expect(script).toMatch(/--incremental/);
  });

  it('stays out of the seconds-order commit gate', () => {
    // quality-gates, the latency budget: "Analysis that is inherently minutes-order — whole-program
    // search, mutation runs, deep dataflow — belongs in CI ... It never joins the commit gate."
    //
    // Asserted against the lane COMMANDS rather than the whole file, so the gate can carry a
    // comment explaining why mutation is absent without that comment failing this scenario — and
    // so a lane spelled `pnpm exec stryker run` is caught as well as one named "mutation".
    const commands = commitGateText()
      .matchAll(/^\s*\["[^"]+"\]="([^"]*)"/gm)
      .map(([, command]) => command ?? '')
      .toArray();

    expect(commands.length).toBeGreaterThan(5);
    expect(commands.filter((command) => /stryker|test:mutation/.test(command))).toEqual([]);
  });

  it('runs in CI on both paths — a config nothing invokes audits nothing', () => {
    const pipeline = readFileSync(path.join(REPO_ROOT, '.github/workflows/pipeline.yml'), 'utf8');
    const weekly = readFileSync(path.join(REPO_ROOT, '.github/workflows/mutation.yml'), 'utf8');

    // Anchored to the job key and to a step that actually runs Stryker. `toContain('mutation')`
    // was satisfied by the word appearing in an unrelated step name, so deleting the whole job
    // left this green.
    expect(pipeline).toMatch(/^ {2}mutation:$/m);
    expect(pipeline).toMatch(/run: pnpm exec stryker run --mutate/);

    expect(weekly).toMatch(/^ {2}schedule:$/m);
    expect(weekly).toMatch(/^ {4}- cron: '[^']+'$/m);
    expect(weekly).toMatch(/run: pnpm exec stryker run/);
  });

  it("resolves the PR job's scope the same way the config defines it", () => {
    // The workflow re-enumerates the mutate scope in shell. Two independent spellings of one scope
    // drift silently: a third context package would simply stop being mutated on PRs while every
    // lane stayed green.
    const pipeline = readFileSync(path.join(REPO_ROOT, '.github/workflows/pipeline.yml'), 'utf8');

    // Read the workflow's own scope alternation rather than the whole file: `toContain('downloader')`
    // was satisfied by the `music-downloader:e2e` docker tag hundreds of lines away.
    const alternation = /\^packages\/\(([^)]+)\)\/src\//.exec(pipeline)?.[1] ?? '';
    const scopedPackages = alternation.split('|');

    expect(scopedPackages).toHaveLength(includePatterns.length);
    for (const pattern of includePatterns) {
      expect(scopedPackages).toContain(pattern.split('/', 2)[1]);
    }
    // Both negations the config declares are re-stated by the workflow's exclusion grep.
    expect(pipeline).toMatch(/\\\.test\\\.ts\$/);
    expect(pipeline).toContain('__fixtures__');
  });

  it('reads its report from the path the config writes it to', () => {
    // Three independent spellings of this path would let a config change leave both entrypoints
    // quietly reporting "no report" under a green run.
    expect(strykerConfig.jsonReporter?.fileName).toBe(REPORT_PATH);

    // The weekly job asserts the inventory exists by path, so that literal is a third spelling.
    const weekly = readFileSync(path.join(REPO_ROOT, '.github/workflows/mutation.yml'), 'utf8');
    expect(weekly).toContain(REPORT_PATH);
  });

  it('runs the mutation suite the config points at, and that suite reaches both tiers', () => {
    // If a contract-tier glob stopped matching, vitest would NOT error (the unit globs still
    // match) — the tier would just drop out, and every adapter mutant it pins would report as a
    // survivor whose only honest fix is "the assertion exists, in the tier you did not run".
    // `PartialStrykerOptions` types the runner block loosely, so it is read as a record here.
    const runner = strykerConfig.vitest as { configFile?: string } | undefined;
    expect(runner?.configFile).toBe('vitest.mutation.config.ts');

    const includes = mutationSuiteConfig.test?.include ?? [];
    expect(includes.length).toBeGreaterThan(0);
    for (const glob of includes) {
      expect(filesMatching([glob]).size).toBeGreaterThan(0);
    }
    const contractFiles = includes
      .filter((glob) => glob.includes('/test/contract/'))
      .flatMap((glob) => [...filesMatching([glob])]);
    expect(contractFiles.length).toBeGreaterThan(10);
  });
});

describe('mutation waivers', () => {
  it('carries a written justification on every suppression', () => {
    const unjustified = suppressions().filter((entry) => !isJustified(entry.text));

    expect(unjustified.map((entry) => `${entry.location} ${entry.text}`)).toEqual([]);
  });

  it('reads a suppression that has no reason as unjustified', () => {
    // The guard's own failure mode: if the reason check were vacuous, the scenario above would pass
    // over every bare suppression in the tree.
    expect(isJustified('Stryker disable next-line all')).toBe(false);
    expect(isJustified('Stryker disable next-line all:')).toBe(false);
    expect(isJustified('Stryker disable next-line all: no behavior to assert here')).toBe(true);
  });
});

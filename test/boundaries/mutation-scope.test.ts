import { globSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import mutationSuiteConfig from '../../vitest.mutation.config.ts';
import { DIFF_FLAGS } from '../../scripts/mutation/changed-lines.ts';
import { parseRecordedSurvivors } from '../../scripts/mutation/recorded-survivors.ts';
import { REPORT_PATH } from '../../scripts/mutation/report-model.ts';
import { ENFORCE_SWITCH } from '../../scripts/mutation/verdict.ts';
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

/**
 * `packages/eventing` is in scope alongside the two contexts: it carries the seam's delivery and
 * correlation mechanism, so a mutant surviving there survives for BOTH contexts at once.
 */

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

const CONTEXT_SOURCE_TREES = [
  'packages/downloader/src',
  'packages/eventing/src',
  'packages/importer/src',
];

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

function pipelineText(): string {
  return readFileSync(path.join(REPO_ROOT, '.github/workflows/pipeline.yml'), 'utf8');
}

/**
 * The `mutation` job's own text, sliced from the workflow so a scenario about this job cannot be
 * satisfied by an unrelated one hundreds of lines away — the exact failure the scope-alternation
 * scenario below was rewritten to avoid when `toContain('downloader')` was answered by a docker tag.
 */
function mutationJob(): string {
  const text = pipelineText();
  const start = text.indexOf('\n  mutation:\n');
  if (start === -1) {
    // Without this the slice arithmetic returns '', and every `not.toContain` below passes over an
    // empty string — the job could be renamed or deleted and four scenarios would go green.
    throw new Error('The `mutation` job is not in pipeline.yml.');
  }
  const after = /^ {2}[a-z][\w-]*:$/m.exec(text.slice(start + 1 + '  mutation:\n'.length));
  return after === null
    ? text.slice(start)
    : text.slice(start, start + 1 + '  mutation:\n'.length + after.index);
}

/**
 * The job's steps, one string each. A claim like "this step does NOT carry `continue-on-error`" is
 * only worth anything against the step's own block: asserted against the whole job it would be
 * answered by the flag sitting on a *different* step, which is precisely the arrangement this
 * change ships.
 */
function mutationSteps(): string[] {
  return mutationJob()
    .split(/\n {6}- (?=name:|uses:|run:)/)
    .slice(1)
    .map((step) => withoutComments(step));
}

/**
 * A step's YAML with its `#` prose removed.
 *
 * Every positive claim below would otherwise be answerable by a COMMENT. That is not hypothetical:
 * the flags scenario asserted `--no-prefix` against the step's whole text, the step's own comment
 * explains why `--no-prefix` matters, and deleting the flag from the actual command left this tier
 * 25/25 green. The comments are where this job explains itself, so they are exactly the text most
 * likely to contain the words a guard is looking for.
 */
function withoutComments(step: string): string {
  return step
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');
}

/**
 * Fails loudly when no step matches, rather than returning an empty string. Half the scenarios
 * below are `not.toContain` claims, and every one of them would pass over a step that no longer
 * exists — the vacuous-green shape this whole file is written against.
 */
function stepNamed(fragment: string): string {
  const step = mutationSteps().find((candidate) => candidate.includes(fragment));
  if (step === undefined) {
    throw new Error(`No step of the \`mutation\` job contains ${JSON.stringify(fragment)}.`);
  }
  return step;
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
 * Only `disable` directives are waivers. `// Stryker restore all` closes a block-scope disable and
 * takes no `: reason` clause, so demanding a justification from one would report a legitimate
 * comment as a defect — and the block form is forbidden outright below anyway.
 *
 * The comment opener is part of the pattern, because Stryker's own bookkeeper only reads a
 * directive that *begins* a comment. Without it, prose that merely mentions `Stryker disable` — the
 * paragraph in `downloader/composition/runtime.ts` explaining what those waivers are and are not —
 * is scanned as an unjustified waiver, and the only way to satisfy the scan is to stop writing
 * about waivers in English.
 */
const SUPPRESSION_PATTERN = /(?:\/\/|\/\*)\s*(Stryker\s+disable\b[^\n]*)/g;

/** A block disable is closed by a `restore`; with the block form banned, none may exist. */
const RESTORE_PATTERN = /(?:\/\/|\/\*)\s*Stryker\s+restore\b[^\n]*/g;

/**
 * A waiver must name the single line it covers. The block form (`// Stryker disable <mutators>`,
 * closed by `// Stryker restore all`) is banned here, and not for style: Stryker's
 * `DirectiveBookkeeper` reads a node's LEADING comments only, so a `restore` written as the last
 * comment inside a block — after the final statement of the last `case`, say — attaches to no node
 * and is never seen. A block disable whose restore never fires has no end line, and Stryker's
 * line match then succeeds for every line after it: the waiver silences its mutators to the end of
 * the file. That is exactly what two directives in this repo did, hiding 53 and 32 mutants
 * respectively behind an argument written about one `switch` arm, while both files reported a
 * perfect score. `next-line` cannot fail that way.
 */
function isLineScoped(text: string): boolean {
  return /Stryker\s+disable\s+next-line\b/.test(text);
}

function scan(pattern: RegExp): Suppression[] {
  const found: Suppression[] = [];
  for (const file of MUTATED) {
    const lines = readFileSync(path.join(REPO_ROOT, file), 'utf8').split('\n');
    for (const [index, line] of lines.entries()) {
      for (const [whole, captured] of line.matchAll(pattern)) {
        found.push({ location: `${file}:${index + 1}`, text: captured ?? whole });
      }
    }
  }
  return found;
}

function suppressions(): Suppression[] {
  return scan(SUPPRESSION_PATTERN);
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
    expect(mutated.some((file) => file.includes('/domain/download/'))).toBe(true);
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
    expect(pipeline).toMatch(/pnpm exec stryker run --mutate/);

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

  it('trips the safe-character tripwire on unsafe TypeScript, and only on TypeScript', () => {
    // The tripwire exists to catch a path that IS in the mutate scope but whose bytes were dropped
    // by the narrow character class — a filename carrying shell metacharacters, about to become a
    // command argument. Its pre-filter, though, selected on `src/` alone, so it also caught files
    // that were never in scope to begin with: the Python bridge and its `requirements.txt` live
    // under `packages/importer/src/`, and `bridge.py` is audited by `pnpm test:bridge`, not here.
    // Touching either failed the whole mutation job with "rejected by the safe-character filter" —
    // a change with nothing to mutate, reported as a scope violation.
    //
    // Evaluated rather than pattern-matched: the greps are read out of the shipped workflow and run
    // against representative paths, so this fails on the behaviour and not on a rewording.
    const rejectedBlock = /REJECTED="\$\((.*?)\)"/s.exec(
      stepNamed('Resolve the changed production files'),
    )?.[1];
    expect(rejectedBlock).toBeDefined();

    const filters = (rejectedBlock ?? '')
      .matchAll(/match (-vE|-E) '([^']+)'/g)
      .map(([, flag, pattern]) => ({ drop: flag === '-vE', test: new RegExp(pattern ?? '') }))
      .toArray();
    // Three greps: select in-scope, drop test code and fixtures, drop everything the class accepts.
    expect(filters).toHaveLength(3);

    const isRejected = (file: string): boolean =>
      filters.every(({ drop, test }) => (drop ? !test.test(file) : test.test(file)));

    // The Python tier is not TypeScript, so it is not in scope, so it is not a rejection.
    expect(isRejected('packages/importer/src/adapters/beets/bridge/requirements.txt')).toBe(false);
    expect(isRejected('packages/importer/src/adapters/beets/bridge/bridge.py')).toBe(false);
    // Ordinary production TypeScript passes the class and is likewise no rejection.
    expect(isRejected('packages/downloader/src/domain/download/state.ts')).toBe(false);
    // …and the case the tripwire is FOR still bites, or this scenario has argued it away.
    expect(isRejected('packages/downloader/src/domain/oops; rm -rf ~.ts')).toBe(true);
  });

  it('carries the changed-line verdict in a step of its own', () => {
    // Without this, deleting the whole gate — the step that decides — leaves the boundary tier
    // green. The existing scenarios pin the mutation RUN; the run is now advisory by construction
    // (`continue-on-error`), so the run alone proves nothing about whether anything is gated.
    const verdict = stepNamed('pr-verdict.ts');

    expect(verdict).toMatch(/pnpm tsx scripts\/mutation\/pr-verdict\.ts/);
    expect(verdict).toContain('$GITHUB_STEP_SUMMARY');
  });

  it('runs the verdict even when the mutation run failed', () => {
    // always(): a crashed run is exactly when the verdict matters most, and it fails on a missing
    // or unreadable report. A verdict step that skipped on a failed Stryker step would skip the
    // step whose whole job is to fail on a crash.
    expect(stepNamed('pr-verdict.ts')).toMatch(/if: always\(\)/);
  });

  it('keeps `continue-on-error` on the mutation run and off the verdict', () => {
    // The flag MOVES, it does not disappear (design D5). It stays on the Stryker step precisely
    // because that step's exit code stops being the verdict: `thresholds.break: 100` fails on any
    // survivor anywhere in the file-wide reporting scope, which is the verdict line scope rejects.
    // A flag that crept onto the verdict step would make the whole gate inert again, silently.
    expect(stepNamed('stryker run --mutate')).toContain('continue-on-error: true');
    expect(stepNamed('pr-verdict.ts')).not.toContain('continue-on-error');
  });

  it('ships the verdict in shadow — the enforcement switch is absent', () => {
    // Shadow is the shipped first state, and the flip is a decision on a measurement taken here
    // (quality-gates.md's ten-percent bar), not a side effect of landing this job.
    expect(mutationJob()).not.toContain(`${ENFORCE_SWITCH}:`);
  });

  it('feeds the verdict a diff cut with the flags the parser was written against', () => {
    // The silent-green hazard. If the job's git spelling and `changed-lines.ts`'s expectations ever
    // part company — a dropped `--no-prefix`, most likely — every intersection returns false and the
    // gate stops measuring. Asserted against the INVOCATION, not the step: the step also runs two
    // `git diff --name-only` commands that carry `--diff-filter=ACMR`, and its prose names
    // `--no-prefix` outright, so a step-wide `toContain` is answered by text that does not run.
    const hunkDiff = stepNamed('Resolve the changed production files')
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.startsWith('git diff -U0'));

    expect(hunkDiff).toBeDefined();
    for (const flag of DIFF_FLAGS) {
      expect(hunkDiff).toContain(flag);
    }
  });

  it('hands the verdict the very file the scope step wrote', () => {
    // Two spellings of one path, in two steps. Rename one and the verdict reads nothing, refuses as
    // `no-diff`, and — once enforcing — reddens every correct branch. This is the same three-way
    // pin `REPORT_PATH` already gets, for the same reason.
    const written = /(\$\{RUNNER_TEMP\}\/[\w.-]+\.diff)/.exec(
      stepNamed('Resolve the changed production files'),
    )?.[1];

    expect(written).toBeDefined();
    expect(stepNamed('pr-verdict.ts')).toContain(written);
  });

  it('resolves exactly one merge-base for the whole job', () => {
    // The mutate scope and the changed hunks must be the same comparison. Two `git merge-base`
    // calls is two chances to answer differently — and a hunk set computed against a different base
    // gates lines the branch did not write.
    expect(mutationJob().match(/git merge-base/g)).toHaveLength(1);
  });

  it('budgets the job for the runs actually observed, not for a projection', () => {
    // Once this check blocks, a timeout is a red required check on a correct branch: unattributable
    // and non-deterministically reproducible, which is what teaches a loop that a check is flaky.
    // The largest observed run was 13m58s.
    // The number is read and compared, not matched: raising the budget after a slower run is the
    // correct response to a slower run, and a literal pin would call that a regression.
    const budget = Number(/timeout-minutes: (\d+)/.exec(mutationJob())?.[1]);

    expect(budget).toBeGreaterThanOrEqual(28); // ~2x the largest observed run (13m58s)
    expect(mutationJob()).not.toMatch(/NOT yet observed in CI/);
  });

  it('argues its configuration from no number its own design retracts', () => {
    // The job's comment used to justify `continue-on-error` from "464 survivors to 6 (99.89%)".
    // `mutation-gate`'s design.md explicitly retracts that score — it was hiding 104 killable
    // mutants behind two block directives that never closed. A retracted figure left arguing for a
    // live decision is how the next reader relitigates it.
    expect(mutationJob()).not.toContain('99.89');
    expect(mutationJob()).not.toContain('464');
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

  it('scopes every suppression to one line — a block disable can silently never end', () => {
    const blockScoped = suppressions().filter((entry) => !isLineScoped(entry.text));

    expect(blockScoped.map((entry) => `${entry.location} ${entry.text}`)).toEqual([]);
  });

  it('holds the suppression count to a ceiling — a rising one is the signal', () => {
    // design.md: "a rising suppression count is the signal that the rule failed admission and
    // nobody noticed". Nothing measured it, so a waiver could be added per PR forever without any
    // check going red. This number is a CEILING TO DRIVE DOWN, never a budget to spend: lowering it
    // when waivers are retired is the point, raising it is a decision that belongs in a review.
    const CEILING = 58;

    expect(suppressions().length).toBeLessThanOrEqual(CEILING);
  });

  it('leaves no `Stryker restore` behind — the only thing one can close is a block disable', () => {
    // The second half of the same rule, and the cheaper half to check: a `restore` in the tree
    // means a block disable is (or was) open. Scanned separately because a restore takes no reason
    // and would be reported as an unjustified waiver by the scenario above.
    expect(scan(RESTORE_PATTERN).map((entry) => entry.location)).toEqual([]);
  });

  it('reads a block-scope suppression as unscoped, however it is spelled', () => {
    // The guard's own failure mode, as above: a vacuous scope check would pass over every block
    // disable in the tree.
    expect(isLineScoped('Stryker disable next-line StringLiteral: a compile-time pin')).toBe(true);
    expect(isLineScoped('Stryker disable StringLiteral: a compile-time pin')).toBe(false);
    expect(isLineScoped('Stryker disable all')).toBe(false);
  });

  it('reads a suppression that has no reason as unjustified', () => {
    // The guard's own failure mode: if the reason check were vacuous, the scenario above would pass
    // over every bare suppression in the tree.
    expect(isJustified('Stryker disable next-line all')).toBe(false);
    expect(isJustified('Stryker disable next-line all:')).toBe(false);
    expect(isJustified('Stryker disable next-line all: no behavior to assert here')).toBe(true);
  });
});

/**
 * The per-mutant waiver (change: mutation-recorded-survivors) is held to the same burden as the
 * line-granular one above, plus one this form needs and that one does not.
 *
 * A malformed `disable next-line` is at worst inert — Stryker ignores it and the mutant keeps
 * surviving, which is loud. A malformed recorded-survivor marker is inert in exactly the same way,
 * and that is the danger: the author believes a mutant is waived, the weekly run keeps filing it,
 * and the two facts never meet. So every comment that OPENS with the marker phrase must actually
 * parse as one.
 */
const RECORDED_MARKER_OPENER = /(?:\/\/|\/\*)\s*(Stryker\s+recorded-survivor\b[^\n]*)/g;

/** Every marker the parser actually accepts, across the mutated tree. */
function parsedRecordedMarkers(): { readonly file: string; readonly reason: string }[] {
  return MUTATED.flatMap((file) =>
    parseRecordedSurvivors(readFileSync(path.join(REPO_ROOT, file), 'utf8')).map((entry) => ({
      file,
      reason: entry.reason,
    })),
  );
}

describe('recorded survivors', () => {
  it('parses every comment that opens with the marker phrase — a malformed one waives nothing, silently', () => {
    // The count is the assertion. A marker the parser rejects still READS as a waiver to a human,
    // so the file looks argued while the mutant is re-filed every Sunday.
    expect(parsedRecordedMarkers()).toHaveLength(scan(RECORDED_MARKER_OPENER).length);
  });

  it('carries a written justification on every marker, held to the same burden as an `any`', () => {
    const unargued = parsedRecordedMarkers().filter(
      (entry) => entry.reason.length < MIN_JUSTIFICATION_CHARS,
    );

    expect(unargued).toEqual([]);
  });

  it('reaches real markers, so the two scenarios above cannot pass over an empty set', () => {
    // Both scenarios are satisfied by finding nothing at all — including if the parser broke, or if
    // the scan's pattern stopped matching the form the tree actually uses.
    expect(parsedRecordedMarkers().length).toBeGreaterThan(10);
  });

  it('holds the recorded-survivor count to a ceiling — a rising one is the same signal', () => {
    // As with suppressions: a CEILING TO DRIVE DOWN, not a budget. Every entry here is a mutant no
    // test can kill; a change that adds many at once is the rule failing admission, not the code.
    const CEILING = 19;

    expect(parsedRecordedMarkers().length).toBeLessThanOrEqual(CEILING);
  });

  it('is read by the machine, not only by a reader — the drift channel subtracts it', () => {
    // "A suppression the machine never reads is the one that rots" (stryker.config.mjs). The
    // fourteen prose comments this form replaced were exactly that, so the wiring is pinned here:
    // both the weekly channel and the PR verdict must apply the transform.
    const drift = readFileSync(path.join(REPO_ROOT, 'scripts/mutation/file-drift.ts'), 'utf8');
    const verdict = readFileSync(path.join(REPO_ROOT, 'scripts/mutation/pr-verdict.ts'), 'utf8');

    expect(drift).toContain('applyRecordedSurvivors');
    expect(verdict).toContain('refineReportText');
  });
});

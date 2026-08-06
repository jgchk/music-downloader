import path from 'node:path';
import { ESLint } from 'eslint';
import type { Linter } from 'eslint';
import { describe, expect, it } from 'vitest';

/**
 * The lint profile itself, pinned where deleting a rule would otherwise be a silent win.
 *
 * `boundaries.test.ts` pins the boundary ZONES; nothing pinned the rules. `neverthrow/must-use-result`
 * is the rule this change exists to add, and it was the least defended thing in the repo: removing
 * the line from `eslint.config.js` cannot produce a lint violation — it can only remove them — so
 * every lane stayed green and the constitutional claim "never ignore a Result" quietly stopped being
 * enforced. These scenarios fail on the deletion instead.
 *
 * The second half pins the test-code carve-out. Its doc comment enumerates the divergence from the
 * production profile, and a hand-maintained enumeration is a claim, not a check: the comment has
 * already been wrong in both directions at once — naming a rule that was never enabled in
 * production (so switching it off diverged from nothing) while missing that the CLI entrypoints
 * swept in by the same globs diverge by a different set again. Deriving both sets from the resolved
 * config makes the comment checkable, so the next carve-out cannot land undeclared.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

const eslint = new ESLint({ cwd: REPO_ROOT });

/**
 * Production source, one file per tier that must run the full profile. Named individually rather
 * than globbed: the question here is what the config RESOLVES to for a real path, which is exactly
 * what a glob would paper over.
 */
const PRODUCTION_FILES = [
  'packages/downloader/src/application/events/catch-up-subscription.ts',
  'packages/importer/src/application/events/catch-up-subscription.ts',
  'packages/web/src/lib/server/runtime.ts',
  'scripts/release/version-prep.ts',
];

/** Test code proper: the carve-out applies in full. */
const TEST_FILES = [
  'packages/downloader/src/application/events/catch-up-subscription.test.ts',
  'packages/downloader/test/contract/support/fixture.ts',
  'packages/web/tests/login.spec.ts',
  'test/boundaries/boundaries.test.ts',
];

/**
 * Command-line programs that live inside the test tiers, so the `testFiles` globs sweep them in and
 * the `cliEntrypoints` block re-arms them. Their divergence is therefore a DIFFERENT set — which is
 * the half of the carve-out comment that used to go unsaid.
 */
const CLI_ENTRYPOINTS_IN_TEST_TIERS = [
  'packages/downloader/test/contract/record/slskd.ts',
  'packages/web/test/contract/drift/plextv.ts',
];

/**
 * The rules the test-code carve-out switches off, derived below and compared against this list.
 * `@typescript-eslint/no-non-null-assertion` is deliberately absent: `recommendedTypeChecked` never
 * enables it, so the carve-out's `'off'` diverges from nothing.
 */
const TEST_CODE_DIVERGENCE = [
  '@typescript-eslint/unbound-method',
  'neverthrow/must-use-result',
  'unicorn/consistent-function-scoping',
  'unicorn/name-replacements',
  'unicorn/no-top-level-assignment-in-function',
];

/** The same for a CLI entrypoint: `must-use-result` is re-armed, `no-process-exit` is released. */
const CLI_ENTRYPOINT_DIVERGENCE = [
  '@typescript-eslint/unbound-method',
  'unicorn/consistent-function-scoping',
  'unicorn/name-replacements',
  'unicorn/no-process-exit',
  'unicorn/no-top-level-assignment-in-function',
];

type Severity = 'off' | 'warn' | 'error';

/** A rule entry is a severity, or an array whose head is one; an absent rule is `off`. */
function severityOf(entry: Linter.RuleEntry | undefined): Severity {
  const level = Array.isArray(entry) ? entry[0] : entry;
  if (level === 2 || level === 'error') return 'error';
  if (level === 1 || level === 'warn') return 'warn';
  return 'off';
}

async function rulesFor(file: string): Promise<Partial<Linter.RulesRecord>> {
  // `calculateConfigForFile` is typed as returning `any`; the rules map is the only part read.
  const config = (await eslint.calculateConfigForFile(path.join(REPO_ROOT, file))) as {
    rules?: Partial<Linter.RulesRecord>;
  };
  return config.rules ?? {};
}

async function severityIn(file: string, rule: string): Promise<Severity> {
  const rules = await rulesFor(file);
  return severityOf(rules[rule]);
}

/** Code-unit order, so the declarations above read the way this sorts them. */
function byName(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** Every rule whose resolved severity differs between the two files, sorted. */
async function divergenceFrom(baseline: string, file: string): Promise<string[]> {
  const [left, right] = await Promise.all([rulesFor(baseline), rulesFor(file)]);
  const names = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...names]
    .filter((rule) => severityOf(left[rule]) !== severityOf(right[rule]))
    .toSorted(byName);
}

describe('the production Result rule', () => {
  it('is armed as an error on every production tier', async () => {
    // The rule the change exists to add. Nothing else in the repo fails when it is deleted.
    const armed = await Promise.all(
      PRODUCTION_FILES.map(async (file) => [
        file,
        await severityIn(file, 'neverthrow/must-use-result'),
      ]),
    );

    expect(armed).toEqual(PRODUCTION_FILES.map((file) => [file, 'error']));
  });

  it('stays armed for the CLI entrypoints the test carve-out sweeps in', async () => {
    // A recorder or drift checker asserts nothing, so a discarded failed Result there writes a
    // fixture from bad data and the whole tier replays a lie. The re-arm is load-bearing.
    const armed = await Promise.all(
      CLI_ENTRYPOINTS_IN_TEST_TIERS.map(async (file) => [
        file,
        await severityIn(file, 'neverthrow/must-use-result'),
      ]),
    );

    expect(armed).toEqual(CLI_ENTRYPOINTS_IN_TEST_TIERS.map((file) => [file, 'error']));
  });

  it('keeps its defence-in-depth partner armed too', async () => {
    // `ResultAsync` is a PromiseLike, not a Promise, so `checkThenables` is what catches an
    // un-awaited one. Dropping the option is as silent a regression as dropping the rule.
    const rules = await rulesFor(PRODUCTION_FILES[0]!);
    const floating = rules['@typescript-eslint/no-floating-promises'];

    expect(severityOf(floating)).toBe('error');
    expect(Array.isArray(floating) ? floating[1] : undefined).toEqual({ checkThenables: true });
  });
});

describe('the test-code carve-out', () => {
  it('diverges from the production profile in exactly the rules it names', async () => {
    const diverged = await Promise.all(
      TEST_FILES.map(async (file) => divergenceFrom(PRODUCTION_FILES[0]!, file)),
    );

    expect(diverged).toEqual(TEST_FILES.map(() => TEST_CODE_DIVERGENCE));
  });

  it('diverges differently for a CLI entrypoint inside the test tiers', async () => {
    const diverged = await Promise.all(
      CLI_ENTRYPOINTS_IN_TEST_TIERS.map(async (file) => divergenceFrom(PRODUCTION_FILES[0]!, file)),
    );

    expect(diverged).toEqual(CLI_ENTRYPOINTS_IN_TEST_TIERS.map(() => CLI_ENTRYPOINT_DIVERGENCE));
  });

  it('names no rule production never enabled — an "off" over an "off" is dead config', async () => {
    // The overclaim this suite exists to prevent, stated as a check: every rule the carve-out
    // switches off must actually be ON in production, or switching it off diverges from nothing
    // and the enumeration describes a profile the repo does not have.
    const production = await rulesFor(PRODUCTION_FILES[0]!);
    const dead = TEST_CODE_DIVERGENCE.filter((rule) => severityOf(production[rule]) === 'off');

    expect(dead).toEqual([]);
  });
});

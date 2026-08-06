import { existsSync } from 'node:fs';
import path from 'node:path';
import { ESLint } from 'eslint';
import type { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import config from '../../eslint.config.js';

/**
 * The lint profile itself, pinned where deleting a rule would otherwise be a silent win.
 *
 * `boundaries.test.ts` pins the boundary ZONES; nothing pinned the rules. `neverthrow/must-use-result`
 * is the rule this change exists to add, and it was the least defended thing in the repo: removing
 * the line from `eslint.config.js` cannot produce a lint violation — it can only remove them — so
 * every lane stayed green and the constitutional claim "never ignore a Result" quietly stopped being
 * enforced. These scenarios fail on the deletion instead.
 *
 * Two complementary readings, because neither alone is enough. The per-file scenarios resolve the
 * config for real paths, which is the only way to see what a file actually gets; but a list of
 * sample paths can never prove a NEGATIVE — a carve-out aimed somewhere the samples do not name
 * (`packages/*&#47;src/adapters/**`, say) would disable the rule across production while every
 * sample stayed green. That hole was found by mutation, so the structural scenario reads the config
 * ARRAY instead and pins every block that so much as mentions the rule. Between them: what a file
 * gets, and that nothing else can quietly grant it.
 *
 * The rest pins the test-code carve-out. Its doc comment enumerates the divergence from the
 * production profile, and a hand-maintained enumeration is a claim, not a check: the comment has
 * already been wrong twice — naming a rule that was never enabled in production (so switching it
 * off diverged from nothing), and describing every CLI entrypoint as diverging by one set when the
 * `scripts`-tree ones are not swept into the carve-out at all. Deriving all three sets from the
 * resolved config makes the comment checkable, so the next carve-out cannot land undeclared.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

const eslint = new ESLint({ cwd: REPO_ROOT });

/**
 * Production source, one file per tier that must run the full profile. Named individually rather
 * than globbed: the question here is what the config RESOLVES to for a real path, which is exactly
 * what a glob would paper over.
 */
const PRODUCTION_FILES = [
  'packages/downloader/src/domain/acquisition/decide.ts',
  'packages/downloader/src/application/events/catch-up-subscription.ts',
  'packages/downloader/src/adapters/sqlite/event-store.ts',
  'packages/downloader/src/interfaces/contracts/events/mapping.ts',
  'packages/downloader/src/composition/runtime.ts',
  'packages/importer/src/application/events/catch-up-subscription.ts',
  'packages/web/src/lib/server/runtime.ts',
  'scripts/release/version-prep.ts',
];

/**
 * The baseline every divergence below is measured against. Named separately rather than reusing
 * the first entry above: some production files carry extra layer-scoped blocks of their own (the
 * domain's logger ban, the web's runtime-import ban), and measuring against one of those would
 * report those blocks as carve-out divergence. This file is in no such block.
 */
const PRODUCTION_BASELINE = 'packages/downloader/src/application/events/catch-up-subscription.ts';

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
 * `@typescript-eslint/no-non-null-assertion` is deliberately absent, and stayed absent through the
 * strict-tier bump: `strictTypeChecked` does enable it, but the production profile rejects it
 * repo-wide, so a carve-out `'off'` here would diverge from nothing. The "names no rule production
 * never enabled" scenario below is what keeps that distinction honest.
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

/**
 * The other kind of CLI entrypoint: the schema generators under a package's `scripts` tree. No
 * `testFiles` glob matches them, so the carve-out never applies and there is nothing to re-arm —
 * they diverge from production by the one rule their own block releases.
 */
const CLI_ENTRYPOINTS_OUTSIDE_TEST_TIERS = [
  'packages/downloader/scripts/contracts/generate-event-schemas.ts',
  'packages/importer/scripts/contracts/generate-event-schemas.ts',
];

const SCRIPTS_TREE_CLI_DIVERGENCE = ['unicorn/no-process-exit'];

/**
 * The `testFiles` constant and the `cliEntrypoints` constant, restated. The structural scenario
 * compares the config's own `files` arrays against these, so moving a carve-out to a new glob has
 * to be declared here — which is the point, since that is the move a sample-path check cannot see.
 */
const TEST_CODE_GLOBS = [
  '**/*.test.ts',
  'test/**/*.ts',
  'packages/*/test/**/*.ts',
  'packages/web/tests/**/*.ts',
];

const CLI_ENTRYPOINT_GLOBS = [
  'packages/*/scripts/**/*.ts',
  'packages/*/test/contract/record/**/*.ts',
  'packages/*/test/contract/drift/**/*.ts',
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

/**
 * A rule entry reduced to a comparable value: its level AND its options. Comparing severity alone
 * would miss the drift that matters most quietly — a carve-out that keeps a rule at `error` while
 * stripping the option doing the work. `['error', { checkThenables: false }]` in the test block is
 * a real regression that a severity-only diff reports as no divergence at all.
 */
function entryOf(entry: Linter.RuleEntry | undefined): string {
  const options = Array.isArray(entry) ? entry.slice(1) : [];
  return JSON.stringify([severityOf(entry), options]);
}

/** Every rule whose resolved level or options differ between the two files, sorted. */
async function divergenceFrom(baseline: string, file: string): Promise<string[]> {
  const [left, right] = await Promise.all([rulesFor(baseline), rulesFor(file)]);
  const names = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...names].filter((rule) => entryOf(left[rule]) !== entryOf(right[rule])).toSorted(byName);
}

/**
 * The rules the strict tiers enable that the production profile deliberately switches back off.
 * Each one is rejected under the admission contract (docs/development/quality-gates.md) with its
 * reasoning at the disable site in `eslint.config.js`; this list is the checkable half of that
 * claim. Adding a carve-out without declaring it here fails the scenario below — which is the
 * whole point, because a silent `'off'` is exactly how a strict profile decays back into a weak
 * one while every lane stays green.
 */
const STRICT_TIER_CARVE_OUTS = [
  '@typescript-eslint/no-empty-function',
  '@typescript-eslint/no-invalid-void-type',
  '@typescript-eslint/no-non-null-assertion',
  '@typescript-eslint/no-unnecessary-condition',
];

/** Every rule the two strict tiers arm, flattened across their config objects. */
function rulesEnabledByStrictTiers(): string[] {
  const tiers = [...tseslint.configs.strictTypeChecked, ...tseslint.configs.stylisticTypeChecked];
  const enabled = new Set<string>();
  for (const entry of tiers) {
    const declared = Object.entries(entry.rules ?? {});
    // Later tiers override earlier ones, and they do switch rules back OFF (the base-eslint rule a
    // typed rule replaces, for one), so this folds in order rather than unioning.
    for (const [rule, value] of declared) {
      if (severityOf(value as Linter.RuleEntry) === 'off') enabled.delete(rule);
      else enabled.add(rule);
    }
  }
  return [...enabled].toSorted(byName);
}

describe('the strict typed profile', () => {
  it('arms every rule the strict tiers publish, except the declared carve-outs', async () => {
    // The constitutional claim is "the production profile extends the STRICTEST typed tiers"
    // (module-architecture). Naming the tiers in `extends` is not that claim — a tier can be named
    // and then hollowed out rule-by-rule, which is the drift this pins. Deriving the expectation
    // from the tier packages themselves means a toolchain upgrade that adds a rule shows up here
    // as a decision to make, not as silence.
    const production = await rulesFor(PRODUCTION_BASELINE);
    const off = rulesEnabledByStrictTiers().filter(
      (rule) => severityOf(production[rule]) !== 'error',
    );

    expect(off).toEqual(STRICT_TIER_CARVE_OUTS);
  });

  it('declares no carve-out for a rule the strict tiers never armed', () => {
    // The mirror of the scenario above, and the same overclaim the test-code carve-out already
    // guards against: a name in the list that no tier enables would describe a profile the repo
    // does not have, and would keep passing forever.
    const armed = new Set(rulesEnabledByStrictTiers());

    expect(STRICT_TIER_CARVE_OUTS.filter((rule) => !armed.has(rule))).toEqual([]);
  });
});

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

  it('is mentioned by exactly three config blocks, each over the globs it declares', () => {
    // The scenarios above resolve the config for sample paths, and no list of samples can prove a
    // negative: a carve-out aimed at a tree none of them names — `packages/*` `/src/adapters/**`,
    // say — would switch the rule off across production with every one of them still green. That
    // exact mutation slipped through an earlier draft of this suite. Reading the config array
    // instead makes the claim total: ANY block touching the rule has to be declared right here,
    // whatever paths it targets and whichever direction it moves the severity.
    const mentions = config
      .filter((entry) => entry.rules?.['neverthrow/must-use-result'] !== undefined)
      .map((entry) => ({
        files: entry.files,
        severity: severityOf(entry.rules?.['neverthrow/must-use-result']),
      }));

    expect(mentions).toEqual([
      { files: ['**/*.ts'], severity: 'error' },
      { files: TEST_CODE_GLOBS, severity: 'off' },
      { files: CLI_ENTRYPOINT_GLOBS, severity: 'error' },
    ]);
  });

  it('keeps its defence-in-depth partner armed, with the option that does the work', async () => {
    // `ResultAsync` is a PromiseLike, not a Promise, so `checkThenables` is what catches an
    // un-awaited one. Dropping the OPTION is as silent a regression as dropping the rule, and a
    // severity check cannot see it — so the whole entry is pinned, across every sampled tier
    // rather than one file. (A test-block override of the option surfaces separately, as carve-out
    // divergence, because that comparison is option-aware too.)
    const armed = entryOf(['error', { checkThenables: true }]);
    const resolved = await Promise.all(
      PRODUCTION_FILES.map(async (file) => {
        const rules = await rulesFor(file);
        return [file, entryOf(rules['@typescript-eslint/no-floating-promises'])];
      }),
    );

    expect(resolved).toEqual(PRODUCTION_FILES.map((file) => [file, armed]));
  });

  it('samples only paths that exist — a rename must not leave it pinning a phantom', () => {
    // `calculateConfigForFile` answers happily for a path that is not on disk, so a moved file
    // would leave every scenario above green against nothing. The non-empty floor is the same
    // guard one step earlier: an emptied sample list would satisfy every `toEqual([])` here.
    const samples = [
      ...PRODUCTION_FILES,
      PRODUCTION_BASELINE,
      ...TEST_FILES,
      ...CLI_ENTRYPOINTS_IN_TEST_TIERS,
      ...CLI_ENTRYPOINTS_OUTSIDE_TEST_TIERS,
    ];

    expect(samples.length).toBeGreaterThan(0);
    expect(samples.filter((file) => !existsSync(path.join(REPO_ROOT, file)))).toEqual([]);
  });
});

describe('the test-code carve-out', () => {
  it('diverges from the production profile in exactly the rules it names', async () => {
    const diverged = await Promise.all(
      TEST_FILES.map(async (file) => divergenceFrom(PRODUCTION_BASELINE, file)),
    );

    expect(diverged).toEqual(TEST_FILES.map(() => TEST_CODE_DIVERGENCE));
  });

  it('diverges differently for a CLI entrypoint inside the test tiers', async () => {
    const diverged = await Promise.all(
      CLI_ENTRYPOINTS_IN_TEST_TIERS.map(async (file) => divergenceFrom(PRODUCTION_BASELINE, file)),
    );

    expect(diverged).toEqual(CLI_ENTRYPOINTS_IN_TEST_TIERS.map(() => CLI_ENTRYPOINT_DIVERGENCE));
  });

  it('does not reach the CLI entrypoints outside the test tiers at all', async () => {
    // The `scripts`-tree schema generators are matched by no `testFiles` glob, so the carve-out
    // never applies to them and the re-arm has nothing to undo. Their divergence is the single
    // rule their own block releases — the case the config comment used to fold in with the others.
    const diverged = await Promise.all(
      CLI_ENTRYPOINTS_OUTSIDE_TEST_TIERS.map(async (file) =>
        divergenceFrom(PRODUCTION_BASELINE, file),
      ),
    );

    expect(diverged).toEqual(
      CLI_ENTRYPOINTS_OUTSIDE_TEST_TIERS.map(() => SCRIPTS_TREE_CLI_DIVERGENCE),
    );
  });

  it('names no rule production never enabled — an "off" over an "off" is dead config', async () => {
    // The overclaim this suite exists to prevent, stated as a check: every rule the carve-out
    // switches off must actually be ON in production, or switching it off diverges from nothing
    // and the enumeration describes a profile the repo does not have.
    const production = await rulesFor(PRODUCTION_BASELINE);
    const dead = TEST_CODE_DIVERGENCE.filter((rule) => severityOf(production[rule]) === 'off');

    expect(dead).toEqual([]);
  });
});

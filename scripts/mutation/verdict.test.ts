import { describe, expect, it } from 'vitest';
import type { MutationReport, ReportedMutant } from './report-model.ts';
import { decideVerdict, exitCodeFor, isBlocking, readEnforcement } from './verdict.ts';

/**
 * The gate's decision. Everything else in `scripts/mutation/` explains; this module is the only one
 * that says yes or no, so every one of its wrong answers is a wrong verdict rather than a worse
 * paragraph.
 *
 * Three of its failure conditions exist because the alternative is a gate that greens on its own
 * breakage — a crashed run, an unreadable report, or a scope in which nothing was actually analysed
 * must never read as a clean bill. The fourth, a report and a diff whose path spellings do not join,
 * is the same shape and the most dangerous of them: every intersection returns false, no finding is
 * produced, and the gate is vacuously and permanently green while looking exactly like success.
 */

const mutant = (
  start: number,
  end: number,
  overrides: Partial<ReportedMutant> = {},
): ReportedMutant => ({
  mutatorName: 'BlockStatement',
  status: 'Survived',
  location: { start: { line: start }, end: { line: end } },
  replacement: '{}',
  ...overrides,
});

const report = (files: MutationReport['files']): string => JSON.stringify({ files });

/** A one-line edit to line 20 of `a.ts`, in the form `git diff -U0 --no-prefix` prints it. */
const DIFF_AT_LINE_20 = [
  'diff --git a.ts a.ts',
  '--- a.ts',
  '+++ a.ts',
  '@@ -20 +20 @@',
  '+edited',
].join('\n');

function decide(reportText: string | undefined, diff = DIFF_AT_LINE_20) {
  return decideVerdict({ report: reportText, diff });
}

describe('a survivor on a changed line', () => {
  it('is a blocking finding, named by file, line and mutator', () => {
    const verdict = decide(report({ 'a.ts': { mutants: [mutant(20, 20)] } }));

    expect(verdict.kind).toBe('findings');
    expect(isBlocking(verdict)).toBe(true);
    expect(verdict.kind === 'findings' && verdict.findings).toEqual([
      { file: 'a.ts', line: 20, mutant: mutant(20, 20), folded: 0 },
    ]);
  });

  it('counts a mutant whose span ENCLOSES the changed line', () => {
    // The whole-block family Stryker's own containment filter would never have generated. It is
    // 72% of Google's mutants and the second-least likely to survive, so a verdict that dropped it
    // would be silently missing the findings most likely to be real.
    const verdict = decide(report({ 'a.ts': { mutants: [mutant(10, 40)] } }));

    expect(verdict.kind).toBe('findings');
  });

  it('does not count a survivor on a line the branch never touched', () => {
    const verdict = decide(report({ 'a.ts': { mutants: [mutant(20, 20), mutant(90, 95)] } }));

    expect(verdict.kind === 'findings' && verdict.findings.map((f) => f.line)).toEqual([20]);
  });

  it('does not count a survivor abutting the changed line without touching it', () => {
    const verdict = decide(report({ 'a.ts': { mutants: [mutant(18, 19)] } }));

    expect(verdict.kind).toBe('clean');
    expect(isBlocking(verdict)).toBe(false);
  });

  it('does not count a mutant a test killed, even on a changed line', () => {
    const verdict = decide(report({ 'a.ts': { mutants: [mutant(20, 20, { status: 'Killed' })] } }));

    expect(verdict.kind).toBe('clean');
  });

  it('counts an uncovered mutant on a changed line — no test reached it at all', () => {
    const verdict = decide(
      report({ 'a.ts': { mutants: [mutant(20, 20, { status: 'NoCoverage' })] } }),
    );

    expect(verdict.kind).toBe('findings');
  });

  it('does not count a mutant in a file the branch did not change', () => {
    const verdict = decide(
      report({
        'a.ts': { mutants: [mutant(1, 1, { status: 'Killed' })] },
        'untouched.ts': { mutants: [mutant(20, 20)] },
      }),
    );

    expect(verdict.kind).toBe('clean');
  });
});

describe('one finding per changed line', () => {
  it('folds several survivors on one line into a single finding', () => {
    // design D8: one weak line spawns a dozen mutants that all die to the same missing assertion.
    // Counting each of them turns one thing to do into a wall, and a wall is what gets appeased.
    const verdict = decide(
      report({
        'a.ts': {
          mutants: [
            mutant(20, 20, { mutatorName: 'ConditionalExpression', replacement: 'true' }),
            mutant(20, 20, { mutatorName: 'ConditionalExpression', replacement: 'false' }),
            mutant(20, 22, { mutatorName: 'BlockStatement' }),
          ],
        },
      }),
    );

    expect(verdict.kind === 'findings' && verdict.findings).toHaveLength(1);
    expect(verdict.kind === 'findings' && verdict.findings[0]?.folded).toBe(2);
  });

  it('keeps survivors on different lines apart', () => {
    const diff = [
      'diff --git a.ts a.ts',
      '+++ a.ts',
      '@@ -20,2 +20,2 @@',
      '+edited',
      '+edited',
    ].join('\n');
    const verdict = decideVerdict({
      report: report({ 'a.ts': { mutants: [mutant(20, 20), mutant(21, 21)] } }),
      diff,
    });

    expect(verdict.kind === 'findings' && verdict.findings.map((f) => f.line)).toEqual([20, 21]);
  });
});

describe('the report and the diff must join', () => {
  it('joins path spellings that differ only in separator or leading dot', () => {
    // Stryker keys its report `path.relative(cwd, file)` with backslashes normalised; git prints a
    // repo-relative POSIX path under `--no-prefix`. Both are normalised deliberately rather than
    // compared as they arrive.
    const diff = ['+++ packages/importer/src/a.ts', '@@ -20 +20 @@', '+edited'].join('\n');
    const verdict = decideVerdict({
      report: report({ './packages\\importer\\src\\a.ts': { mutants: [mutant(20, 20)] } }),
      diff,
    });

    expect(verdict.kind).toBe('findings');
  });

  it('refuses a scope whose changed files match no file in the report', () => {
    // THE silent-green hazard (design D4's fourth mode). If the two sides ever disagree — a `b/`
    // prefix creeping back in, a Stryker upgrade changing how it keys files — every intersection
    // test returns false and the gate reports "clean" forever while measuring nothing. It must fail
    // as UNAUDITED, never pass as clean.
    const prefixed = ['+++ b/a.ts', '@@ -20 +20 @@', '+edited'].join('\n');
    const verdict = decideVerdict({
      report: report({ 'a.ts': { mutants: [mutant(20, 20)] } }),
      diff: prefixed,
    });

    expect(verdict.kind).toBe('unaudited');
    expect(verdict.kind === 'unaudited' && verdict.reason).toBe('no-file-joined');
    expect(isBlocking(verdict)).toBe(true);
  });

  it('refuses a scope whose diff carried no changed line at all', () => {
    const verdict = decide(report({ 'a.ts': { mutants: [mutant(20, 20)] } }), '');

    expect(verdict.kind === 'unaudited' && verdict.reason).toBe('no-file-joined');
  });

  it('passes a branch that only deleted lines from an audited file', () => {
    // A pure deletion joins the file but gates no line, which is not the same as nothing being
    // audited: the mutants were analysed, and none of them sits on a line this branch wrote.
    const deletion = ['+++ a.ts', '@@ -20,2 +19,0 @@', '-gone', '-gone'].join('\n');
    const verdict = decideVerdict({
      report: report({
        'a.ts': { mutants: [mutant(20, 20), mutant(1, 1, { status: 'Killed' })] },
      }),
      diff: deletion,
    });

    expect(verdict.kind).toBe('clean');
  });
});

describe('a run that measured nothing is not a clean run', () => {
  it('refuses a missing report rather than reporting no findings', () => {
    const verdict = decide(undefined);

    expect(verdict.kind).toBe('no-report');
    expect(isBlocking(verdict)).toBe(true);
  });

  it('refuses a report it cannot read as a mutation report', () => {
    for (const unreadable of ['{ "files": ', 'null', '{}', '{"files":{"a.ts":{"mutants":[{}]}}}']) {
      const verdict = decide(unreadable);

      expect(verdict.kind).toBe('unreadable-report');
      expect(isBlocking(verdict)).toBe(true);
    }
  });

  it('refuses a scope that produced no mutants at all', () => {
    const verdict = decide(report({ 'a.ts': { mutants: [] } }));

    expect(verdict.kind === 'unaudited' && verdict.reason).toBe('no-mutants');
  });

  it('refuses a scope in which every mutant was ignored', () => {
    const verdict = decide(
      report({ 'a.ts': { mutants: [mutant(20, 20, { status: 'Ignored' })] } }),
    );

    expect(verdict.kind === 'unaudited' && verdict.reason).toBe('all-ignored');
  });

  it('accepts a scope with one real mutant among the ignored ones', () => {
    const verdict = decide(
      report({
        'a.ts': {
          mutants: [mutant(20, 20, { status: 'Ignored' }), mutant(1, 1, { status: 'Killed' })],
        },
      }),
    );

    expect(verdict.kind).toBe('clean');
  });
});

describe('a clean verdict still says what it measured', () => {
  it('reports the survivors it saw but did not block on', () => {
    const verdict = decide(
      report({
        'a.ts': { mutants: [mutant(90, 95), mutant(1, 1, { status: 'Killed' })] },
      }),
    );

    expect(verdict.kind === 'clean' && verdict.reportedSurvivors).toBe(1);
    expect(verdict.kind === 'clean' && verdict.counted.mutants).toBe(2);
  });
});

describe('the enforcement switch', () => {
  it('defaults to shadow when it is unset', () => {
    expect(readEnforcement(undefined).enforcement).toBe('shadow');
    expect(readEnforcement('').enforcement).toBe('shadow');
  });

  it('stays shadow when it is explicitly off', () => {
    expect(readEnforcement('false').enforcement).toBe('shadow');
    expect(readEnforcement('0').enforcement).toBe('shadow');
  });

  it('enforces only on an explicit enable', () => {
    expect(readEnforcement('true').enforcement).toBe('enforce');
    expect(readEnforcement('1').enforcement).toBe('enforce');
  });

  it('treats a value it does not recognise as shadow, and says which value', () => {
    // Not a new way to fail the job — a way to be visible. A switch set to `yes` that silently did
    // nothing is how an enforcement flip gets believed without ever happening.
    expect(readEnforcement('yes').enforcement).toBe('shadow');
    expect(readEnforcement('yes').unrecognised).toBe('yes');
    expect(readEnforcement('true').unrecognised).toBeUndefined();
    expect(readEnforcement(undefined).unrecognised).toBeUndefined();
  });
});

describe('shadow and enforce differ in the exit code and nothing else', () => {
  const blocking = decide(report({ 'a.ts': { mutants: [mutant(20, 20)] } }));

  it('exits zero on a blocking verdict while shadow is on', () => {
    expect(exitCodeFor(blocking, 'shadow')).toBe(0);
  });

  it('exits non-zero on the same verdict once enforcing', () => {
    expect(exitCodeFor(blocking, 'enforce')).toBe(1);
  });

  it('exits zero on a clean verdict either way', () => {
    const clean = decide(report({ 'a.ts': { mutants: [mutant(1, 1, { status: 'Killed' })] } }));

    expect(exitCodeFor(clean, 'shadow')).toBe(0);
    expect(exitCodeFor(clean, 'enforce')).toBe(0);
  });

  it('exits non-zero on every refusal once enforcing, not only on findings', () => {
    for (const verdict of [
      decide(undefined),
      decide('not json'),
      decide(report({ 'a.ts': { mutants: [] } })),
    ]) {
      expect(exitCodeFor(verdict, 'enforce')).toBe(1);
      expect(exitCodeFor(verdict, 'shadow')).toBe(0);
    }
  });
});

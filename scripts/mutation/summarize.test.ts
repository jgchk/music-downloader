import { describe, expect, it } from 'vitest';
import type { MutationReport } from './report-model.ts';
import { summarizeReport, summarizeSurvivors } from './summarize.ts';

/**
 * The mutation job's finding surface. Stryker's exit code decides pass/fail; this decides what a
 * reader is told about *why*, and a gate whose failure output is unreadable is a gate that gets
 * appeased rather than fixed (quality-gates: "It names a specific thing to change").
 *
 * The one non-obvious rule is the Google recipe's surfacing cap: at most one mutant per line. A
 * single changed line can generate a dozen mutants that all die to the same missing assertion, and
 * a wall of them reads as noise rather than as one thing to do.
 */

function report(files: MutationReport['files']): MutationReport {
  return { files };
}

describe('mutation summary', () => {
  it('names every surviving mutant by file, line, and mutation', () => {
    const summary = summarizeSurvivors(
      report({
        'packages/importer/src/domain/import/decide.ts': {
          mutants: [
            {
              mutatorName: 'ConditionalExpression',
              status: 'Survived',
              location: { start: { line: 182 } },
              replacement: 'true',
            },
          ],
        },
      }),
    );

    expect(summary).toContain('packages/importer/src/domain/import/decide.ts');
    expect(summary).toContain('182');
    expect(summary).toContain('ConditionalExpression');
    expect(summary).toContain('true');
  });

  it('surfaces at most one mutant per line, and says how many it folded away', () => {
    const summary = summarizeSurvivors(
      report({
        'a.ts': {
          mutants: [
            {
              mutatorName: 'ConditionalExpression',
              status: 'Survived',
              location: { start: { line: 7 } },
              replacement: 'true',
            },
            {
              mutatorName: 'EqualityOperator',
              status: 'Survived',
              location: { start: { line: 7 } },
              replacement: '<=',
            },
            {
              mutatorName: 'BooleanLiteral',
              status: 'Survived',
              location: { start: { line: 9 } },
              replacement: 'false',
            },
          ],
        },
      }),
    );

    // Two lines survive, so two rows — the second mutant on line 7 is folded into the first and
    // marked, never printed as a row of its own.
    expect(summary.match(/^\| `a\.ts`/gm)).toHaveLength(2);
    expect(summary).not.toContain('EqualityOperator');
    expect(summary).toContain('+1');
    expect(summary).toMatch(/3 surviving mutants on 2 lines/);
  });

  it('counts uncovered mutants as surviving — a mutant no test reaches is not killed', () => {
    const summary = summarizeSurvivors(
      report({
        'a.ts': {
          mutants: [
            {
              mutatorName: 'BlockStatement',
              status: 'NoCoverage',
              location: { start: { line: 3 } },
              replacement: '{}',
            },
          ],
        },
      }),
    );

    expect(summary).toContain('NoCoverage');
    expect(summary).toMatch(/1 surviving mutant on 1 line/);
  });

  it('says nothing survived when nothing survived, rather than printing an empty table', () => {
    const summary = summarizeSurvivors(
      report({
        'a.ts': {
          mutants: [
            {
              mutatorName: 'BooleanLiteral',
              status: 'Killed',
              location: { start: { line: 1 } },
              replacement: 'false',
            },
            {
              mutatorName: 'StringLiteral',
              status: 'Ignored',
              location: { start: { line: 2 } },
              replacement: '""',
            },
            {
              mutatorName: 'ArithmeticOperator',
              status: 'Timeout',
              location: { start: { line: 3 } },
              replacement: '-',
            },
          ],
        },
      }),
    );

    // Killed, suppressed (Ignored), and timed-out mutants are all detected — none is a finding.
    expect(summary).toContain('No surviving mutants');
    expect(summary).not.toContain('| `a.ts`');
  });

  it('reads a report with no files at all as "nothing audited", not as a clean run', () => {
    // An empty scope and a clean scope must not read the same. A `--mutate` that resolved to
    // nothing — a renamed directory, a drifted glob — would otherwise report exactly what a
    // genuinely mutant-free diff reports.
    const summary = summarizeSurvivors(report({}));

    expect(summary).not.toContain('No surviving mutants');
    expect(summary).toMatch(/no mutants at all/i);
  });

  it('says nothing was audited when every mutant in scope was ignored', () => {
    // "Clean" and "nothing was analysed" must not read the same. An all-ignored file — every ACL
    // schema is one, since `ignoreStatic` drops module-scope mutants — is not a file this gate
    // audited, and the old wording claimed all three benign causes for it.
    const summary = summarizeSurvivors(
      report({
        'schemas.ts': {
          mutants: [
            {
              mutatorName: 'ObjectLiteral',
              status: 'Ignored',
              location: { start: { line: 1 } },
              replacement: '{}',
            },
          ],
        },
      }),
    );

    expect(summary).toMatch(/nothing in this scope was actually audited/i);
    expect(summary).toContain('1 ignored');
  });

  it('surfaces a status it has no rule for instead of silently counting it detected', () => {
    const summary = summarizeSurvivors(
      report({
        'a.ts': {
          mutants: [
            {
              mutatorName: 'BooleanLiteral',
              status: 'Pending',
              location: { start: { line: 1 } },
              replacement: 'false',
            },
          ],
        },
      }),
    );

    expect(summary).toContain('Pending');
    expect(summary).toMatch(/unknown to the summarizer/i);
  });
});

describe('mutation summary from a raw report', () => {
  it('summarizes the report a run wrote', () => {
    const raw = JSON.stringify(
      report({
        'a.ts': {
          mutants: [
            {
              mutatorName: 'BooleanLiteral',
              status: 'Survived',
              location: { start: { line: 4 } },
              replacement: 'false',
            },
          ],
        },
      }),
    );

    expect(summarizeReport(raw)).toContain('BooleanLiteral');
  });

  it('says the report is missing rather than claiming the run was clean', () => {
    // A crashed run writes no report. Reading that absence as "no surviving mutants" would turn
    // the gate's own breakage into a green summary beside a red job — the worst possible reading.
    const summary = summarizeReport(undefined);

    expect(summary).not.toContain('No surviving mutants');
    expect(summary).toMatch(/no report/i);
  });

  it('says the report is unreadable rather than claiming the run was clean', () => {
    const summary = summarizeReport('{ "files": ');

    expect(summary).not.toContain('No surviving mutants');
    expect(summary).toMatch(/could not read/i);
  });

  it('says so for JSON that parses but is not a report, rather than crashing the explainer', () => {
    // The case an unchecked cast waved through. This runs under `if: always()` precisely on the
    // runs where the report is most likely to be malformed, so it must not throw.
    for (const notAReport of ['null', '{}', '[]', '{"files":null}']) {
      expect(summarizeReport(notAReport)).toMatch(/could not read/i);
    }
  });
});

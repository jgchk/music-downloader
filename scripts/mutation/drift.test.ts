import { describe, expect, it } from 'vitest';
import { driftIssues } from './drift.ts';
import type { MutationReport } from './report-model.ts';

/**
 * The weekly full run's output channel. Drift in code no PR touched has no diff to attach to, so it
 * is filed as tracker issues instead — a durable, visible channel that blocks nothing
 * (mutation-testing: "Full-repo drift is surfaced on a schedule").
 *
 * Two properties carry the whole design. Issues are clustered **per file**, because one weakened
 * module produces a dozen mutants and a dozen issues would be a queue nobody reads. And the title
 * is **stable for a given file**, because that is the key the workflow dedupes on — a title that
 * moved with the mutant count would file a fresh issue every Sunday forever.
 */

function report(files: MutationReport['files']): MutationReport {
  return { files };
}

const survivor = (line: number, mutatorName = 'ConditionalExpression') =>
  ({
    mutatorName,
    status: 'Survived',
    location: { start: { line, column: 1 } },
    replacement: 'true',
  }) as const;

describe('mutation drift issues', () => {
  it('files one issue per file, not one per mutant', () => {
    const issues = driftIssues(
      report({
        'packages/importer/src/domain/import/decide.ts': {
          mutants: [survivor(10), survivor(20), survivor(30)],
        },
        'packages/downloader/src/domain/acquisition/react.ts': { mutants: [survivor(5)] },
      }),
    );

    expect(issues).toHaveLength(2);
  });

  it('titles the issue by its file, so the same drift dedupes against itself next week', () => {
    const once = driftIssues(report({ 'packages/importer/src/a.ts': { mutants: [survivor(10)] } }));
    const later = driftIssues(
      report({
        'packages/importer/src/a.ts': { mutants: [survivor(10), survivor(11), survivor(12)] },
      }),
    );

    expect(once[0]?.title).toBe(later[0]?.title);
    expect(once[0]?.title).toContain('packages/importer/src/a.ts');
  });

  it('renders a table whose rows have as many cells as the header declares', () => {
    // The header and the rows are written in two places; they drifted apart once, and every weekly
    // issue then rendered the mutator under "Status" with the status dropped entirely.
    const [issue] = driftIssues(report({ 'a.ts': { mutants: [survivor(10), survivor(20)] } }));
    const rows = (issue?.body ?? '').split('\n').filter((line) => line.startsWith('| '));
    const cells = (row: string) => row.split('|').length;

    expect(rows).toHaveLength(4); // header, separator, two mutants
    expect(new Set(rows.map((row) => cells(row))).size).toBe(1);
  });

  it('distinguishes an uncovered mutant from a survived one in the body', () => {
    const [issue] = driftIssues(
      report({ 'a.ts': { mutants: [{ ...survivor(10), status: 'NoCoverage' }] } }),
    );

    expect(issue?.body).toContain('NoCoverage');
  });

  it('names every mutant in the body — the issue has to be actionable on its own', () => {
    const [issue] = driftIssues(
      report({
        'packages/importer/src/a.ts': {
          mutants: [survivor(10, 'EqualityOperator'), survivor(42, 'BooleanLiteral')],
        },
      }),
    );

    expect(issue?.body).toContain('10');
    expect(issue?.body).toContain('EqualityOperator');
    expect(issue?.body).toContain('42');
    expect(issue?.body).toContain('BooleanLiteral');
  });

  it('files nothing for a file whose mutants were all detected or suppressed', () => {
    const issues = driftIssues(
      report({
        'packages/importer/src/a.ts': {
          mutants: [
            { ...survivor(1), status: 'Killed' },
            { ...survivor(2), status: 'Ignored' },
            { ...survivor(3), status: 'Timeout' },
          ],
        },
      }),
    );

    expect(issues).toEqual([]);
  });

  it('files nothing at all for a clean run', () => {
    expect(driftIssues(report({}))).toEqual([]);
  });
});

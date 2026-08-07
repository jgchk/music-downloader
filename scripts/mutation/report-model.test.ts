import { describe, expect, it } from 'vitest';
import {
  isSurviving,
  isUnclassified,
  type MutationReport,
  readReport,
  type ReportedMutant,
} from './report-model.ts';

/**
 * The vendor boundary. Everything downstream — the PR summary and the weekly drift channel — trusts
 * this module's answer to two questions: is this JSON a mutation report, and did anything notice
 * this mutant? Both answers are wrong in a silent direction if they are not pinned here.
 */

const mutant = (status: string): ReportedMutant => ({
  mutatorName: 'ConditionalExpression',
  status,
  location: { start: { line: 1 } },
  replacement: 'true',
});

describe('survivorship', () => {
  it('counts a mutant no test noticed as surviving', () => {
    expect(isSurviving(mutant('Survived'))).toBe(true);
    // One step earlier in the same failure: no test even reached it.
    expect(isSurviving(mutant('NoCoverage'))).toBe(true);
  });

  it('counts a detected or waived mutant as not surviving', () => {
    for (const status of ['Killed', 'Timeout', 'Ignored', 'CompileError', 'RuntimeError']) {
      expect(isSurviving(mutant(status))).toBe(false);
    }
  });

  it('reports a status it has no rule for as unclassified rather than silently detected', () => {
    // Stryker's schema already carries `Pending` (a mutant that was never tested), and a future
    // version may add more. Folding an unknown status into "detected" is the one reading that
    // loses drift without anyone noticing — the weekly job has no threshold watching it.
    expect(isUnclassified(mutant('Pending'))).toBe(true);
    expect(isSurviving(mutant('Pending'))).toBe(false);

    expect(isUnclassified(mutant('Survived'))).toBe(false);
    expect(isUnclassified(mutant('Killed'))).toBe(false);
  });
});

describe('reading a report', () => {
  const wellFormed = JSON.stringify({
    files: { 'a.ts': { mutants: [mutant('Survived')] } },
  } satisfies MutationReport);

  it('reads a well-formed report', () => {
    expect(readReport(wellFormed)?.files['a.ts']?.mutants).toHaveLength(1);
  });

  it('reads an absent report as absent', () => {
    expect(readReport(undefined)).toBeUndefined();
  });

  it('reads malformed JSON as absent rather than throwing', () => {
    expect(readReport('{ "files": ')).toBeUndefined();
  });

  it('reads well-formed JSON that is not a report as absent rather than throwing', () => {
    // The case an unchecked cast would wave through: it parses, so every guard downstream that
    // trusts `files` to be an object throws instead — inside the CI step whose entire job is to
    // explain a failing run.
    for (const notAReport of ['null', '{}', '[]', '"hi"', '42', '{"files":null}']) {
      expect(readReport(notAReport)).toBeUndefined();
    }
  });

  it('rejects a report whose mutants are not shaped like mutants', () => {
    // A mutant missing `location.start.line` reaches the renderers as a crash, not a row.
    const missingLocation = JSON.stringify({
      files: { 'a.ts': { mutants: [{ status: 'Survived' }] } },
    });

    expect(readReport(missingLocation)).toBeUndefined();
  });

  it('keeps a file whose mutant list is empty', () => {
    expect(readReport(JSON.stringify({ files: { 'a.ts': { mutants: [] } } }))).toBeDefined();
  });
});

import { describe, expect, it } from 'vitest';
import {
  applyRecordedSurvivors,
  describeStale,
  parseRecordedSurvivors,
  RECORDED_SURVIVOR_REASON,
  refineReportText,
} from './recorded-survivors.ts';
import { readReport } from './report-model.ts';
import type { MutationReport, ReportedMutant } from './report-model.ts';

/**
 * The per-mutant waiver (change: mutation-recorded-survivors).
 *
 * Stryker's own `// Stryker disable next-line <mutator>` is granular to a line and a mutator. At
 * every site this mechanism exists for, the equivalent mutant shares BOTH with a killable sibling —
 * so the vendor's waiver would blind a real check, and the finding needs a waiver as narrow as it
 * is. Naming the replacement text is what buys that narrowness (design D2).
 *
 * Two properties carry the design, and both are ways the mechanism could quietly stop meaning what
 * it says. A marker must waive **exactly** what it names — one mutant, that mutator, that
 * replacement — because a marker that waives a little more than it argues for is a blind spot with
 * a justification stapled to it. And a marker that no longer matches anything must **fail**, since
 * the property the hand-written prose comments never had is that something rechecks them (D4).
 */

const REASON =
  'the narrowing operand is type-level; forced true, the undefined it admits is ignored';

function marker(mutator: string, replacement: string, reason = REASON): string {
  return `// Stryker recorded-survivor ${mutator} \`${replacement}\`: ${reason}`;
}

function mutant(overrides: Partial<ReportedMutant> = {}): ReportedMutant {
  return {
    mutatorName: 'ConditionalExpression',
    status: 'Survived',
    location: { start: { line: 2 }, end: { line: 2, column: 40 } },
    replacement: 'true',
    ...overrides,
  };
}

function report(files: MutationReport['files']): MutationReport {
  return { files };
}

/** A source whose line 2 is the mutated line, with the marker on line 1. */
const SOURCE = [marker('ConditionalExpression', 'true'), 'if (x !== undefined && f(x)) g(x);'].join(
  '\n',
);

describe('parsing a recorded-survivor marker', () => {
  it('reads the mutator, the replacement, and the line the marker speaks for', () => {
    const [parsed] = parseRecordedSurvivors(SOURCE);

    expect(parsed).toMatchObject({
      mutatorName: 'ConditionalExpression',
      replacement: 'true',
      line: 2,
      reason: REASON,
    });
  });

  it('anchors to the next line, so the marker travels with the code it argues about', () => {
    // The whole reason the waiver is a comment at the site rather than an entry in a baseline file:
    // inserting code above it must not invalidate it.
    const shifted = ['', '', '// a leading comment', SOURCE].join('\n');

    expect(parseRecordedSurvivors(shifted)[0]?.line).toBe(5);
  });

  it('reads a replacement containing colons, parens and quotes — the reason a delimiter exists', () => {
    const replacement = 'story === undefined && !isCorrelationId(story)';
    const source = [marker('LogicalOperator', replacement), 'if (a || b) return;'].join('\n');

    expect(parseRecordedSurvivors(source)[0]).toMatchObject({
      mutatorName: 'LogicalOperator',
      replacement,
      reason: REASON,
    });
  });

  it('takes several markers for one line, because a marker waives exactly one mutant', () => {
    const source = [
      marker('ConditionalExpression', 'false'),
      marker('EqualityOperator', 'a > b'),
      'if (a < b) return;',
    ].join('\n');

    expect(parseRecordedSurvivors(source).map((entry) => entry.line)).toEqual([3, 3]);
  });

  it('folds the continuation comment lines into the reason', () => {
    // Every real argument spans several lines — the proof that no test can distinguish a mutant
    // does not fit on one. Reading only the first line would judge "is this argued?" on where the
    // author happened to wrap, and a long replacement can push the whole argument onto line two by
    // itself.
    const source = [
      '// Stryker recorded-survivor EqualityOperator `a >= b`: equivalent.',
      '// `rank` is `indexOf`, so two distinct buckets can only tie by both being absent.',
      'if (a > b) c();',
    ].join('\n');

    const [parsed] = parseRecordedSurvivors(source);

    expect(parsed?.reason).toBe(
      'equivalent. `rank` is `indexOf`, so two distinct buckets can only tie by both being absent.',
    );
    expect(parsed?.line).toBe(3);
  });

  it('stops folding at the next marker, so two arguments never merge into one', () => {
    const source = [
      marker('ConditionalExpression', 'false', 'the first argument, entire'),
      marker('EqualityOperator', 'a > b', 'the second argument, entire'),
      'if (a < b) c();',
    ].join('\n');

    expect(parseRecordedSurvivors(source).map((entry) => entry.reason)).toEqual([
      'the first argument, entire',
      'the second argument, entire',
    ]);
  });

  it('is not a marker when it states no reason — an unargued waiver is the defect', () => {
    const source = [
      '// Stryker recorded-survivor ConditionalExpression `true`',
      'if (a) b();',
    ].join('\n');

    expect(parseRecordedSurvivors(source)).toEqual([]);
  });

  it('is not a marker when the replacement is unterminated', () => {
    const source = [
      '// Stryker recorded-survivor ConditionalExpression `true: a reason that reads fine',
      'if (a) b();',
    ].join('\n');

    expect(parseRecordedSurvivors(source)).toEqual([]);
  });

  it('is not a marker when prose merely mentions the phrase', () => {
    // Design docs and this very file discuss the mechanism by name. A parser that matched on the
    // phrase alone would waive whatever line followed a sentence about waiving.
    const source = [
      '// A recorded-survivor marker names its replacement so the sibling stays observed.',
      'if (a) b();',
    ].join('\n');

    expect(parseRecordedSurvivors(source)).toEqual([]);
  });
});

describe('applying recorded survivors to a report', () => {
  it('reclassifies the named mutant as ignored, so every consumer already treats it as suppressed', () => {
    const { report: applied } = applyRecordedSurvivors(
      report({ 'a.ts': { mutants: [mutant()] } }),
      () => SOURCE,
    );

    expect(applied.files['a.ts']?.mutants[0]).toMatchObject({
      status: 'Ignored',
      statusReason: RECORDED_SURVIVOR_REASON,
    });
  });

  it('leaves a sibling on the same line under the same mutator surviving', () => {
    // The entire point. `ConditionalExpression` on this line generates both `true` (equivalent) and
    // `false` (drops the feature); a line-granular waiver would take both.
    const killable = mutant({ replacement: 'false' });

    const { report: applied } = applyRecordedSurvivors(
      report({ 'a.ts': { mutants: [mutant(), killable] } }),
      () => SOURCE,
    );

    expect(applied.files['a.ts']?.mutants.map((m) => m.status)).toEqual(['Ignored', 'Survived']);
  });

  it('waives one mutant per marker, so a second identical survivor still surfaces', () => {
    const { report: applied } = applyRecordedSurvivors(
      report({ 'a.ts': { mutants: [mutant(), mutant()] } }),
      () => SOURCE,
    );

    expect(applied.files['a.ts']?.mutants.map((m) => m.status)).toEqual(['Ignored', 'Survived']);
  });

  it('does not touch a mutant the suite already detected', () => {
    // A marker names a *survivor*. Reclassifying a killed mutant would be harmless today and a
    // silent downgrade the day the kill regresses.
    const killed = mutant({ status: 'Killed' });

    const { report: applied } = applyRecordedSurvivors(
      report({ 'a.ts': { mutants: [killed] } }),
      () => SOURCE,
    );

    expect(applied.files['a.ts']?.mutants[0]?.status).toBe('Killed');
  });

  it('does not reach across lines', () => {
    const elsewhere = mutant({ location: { start: { line: 9 }, end: { line: 9, column: 3 } } });

    const { report: applied } = applyRecordedSurvivors(
      report({ 'a.ts': { mutants: [elsewhere] } }),
      () => SOURCE,
    );

    expect(applied.files['a.ts']?.mutants[0]?.status).toBe('Survived');
  });
});

describe('a waiver that has outlived its argument', () => {
  it('is reported as stale when the run mutated the file and produced no such survivor', () => {
    const { stale } = applyRecordedSurvivors(
      report({ 'a.ts': { mutants: [mutant({ status: 'Killed' })] } }),
      () => SOURCE,
    );

    expect(stale).toMatchObject([
      { file: 'a.ts', line: 2, mutatorName: 'ConditionalExpression', replacement: 'true' },
    ]);
  });

  it('is stale when only one of two markers found a mutant to waive', () => {
    const source = [marker('ConditionalExpression', 'true'), SOURCE].join('\n');

    const { stale } = applyRecordedSurvivors(
      report({
        'a.ts': {
          mutants: [mutant({ location: { start: { line: 3 }, end: { line: 3, column: 9 } } })],
        },
      }),
      () => source,
    );

    expect(stale).toHaveLength(1);
  });

  it('is stale when a test now kills the mutant — the waiver is genuinely obsolete', () => {
    const { stale } = applyRecordedSurvivors(
      report({ 'a.ts': { mutants: [mutant({ status: 'Killed' })] } }),
      () => SOURCE,
    );

    expect(stale).toHaveLength(1);
  });

  it('is not stale when the mutant timed out — that is the run, not the waiver', () => {
    // `Timeout` is a detected status, so the waiver does not apply this run — but it says nothing
    // about assertion strength. Mutation runs time out under load (a full run shares the machine),
    // and calling that a stale waiver would redden the weekly job for a flake. The waiver has not
    // been contradicted, so it is neither applied nor blamed.
    const { stale } = applyRecordedSurvivors(
      report({ 'a.ts': { mutants: [mutant({ status: 'Timeout' })] } }),
      () => SOURCE,
    );

    expect(stale).toEqual([]);
  });

  it('is not stale when the mutant could not be compiled or run', () => {
    for (const status of ['CompileError', 'RuntimeError'] as const) {
      const { stale } = applyRecordedSurvivors(
        report({ 'a.ts': { mutants: [mutant({ status })] } }),
        () => SOURCE,
      );

      expect(stale, status).toEqual([]);
    }
  });

  it('is not stale in a file the run never mutated', () => {
    // A PR-scoped run mutates the changed files and nothing else. Every marker in the rest of the
    // repo would otherwise read as stale, and the gate would fail on files it did not look at.
    // `unscanned.ts` carries a marker that matches nothing; the run never looked at it, so nothing
    // is claimed about it — and the source is never even read.
    const asked: string[] = [];
    const sources: Record<string, string> = {
      'unscanned.ts': marker('ConditionalExpression', 'never-generated'),
      'a.ts': SOURCE,
    };

    const { stale } = applyRecordedSurvivors(
      report({ 'a.ts': { mutants: [mutant()] } }),
      (file) => {
        asked.push(file);
        return sources[file];
      },
    );

    expect(stale).toEqual([]);
    expect(asked).toEqual(['a.ts']);
  });

  it('is not stale when the source cannot be read at all', () => {
    // A report naming a file that no longer exists on disk is the run being stale, not the waiver.
    const { stale, report: applied } = applyRecordedSurvivors(
      report({ 'gone.ts': { mutants: [mutant()] } }),
      () => {
        return;
      },
    );

    expect(stale).toEqual([]);
    expect(applied.files['gone.ts']?.mutants[0]?.status).toBe('Survived');
  });
});

describe('refining a report handed onward as text', () => {
  it('reclassifies through the round trip', () => {
    const { raw } = refineReportText(
      JSON.stringify(report({ 'a.ts': { mutants: [mutant()] } })),
      () => SOURCE,
    );

    expect(readReport(raw)?.files['a.ts']?.mutants[0]?.status).toBe('Ignored');
  });

  it('preserves per-file fields this tolerant model never declares', () => {
    // Stryker's report carries `source` and `language` per file. Rebuilding the entry from its
    // mutants would drop them and publish a lossy report under the vendor's name.
    const withVendorFields = {
      files: { 'a.ts': { mutants: [mutant()], source: 'if (x) y();', language: 'typescript' } },
    };

    const { raw } = refineReportText(JSON.stringify(withVendorFields), () => SOURCE);

    expect(readReport(raw)?.files['a.ts']).toMatchObject({
      source: 'if (x) y();',
      language: 'typescript',
    });
  });

  it('passes unreadable text through unchanged, so the decider still says "unreadable"', () => {
    // Returning `undefined` here would turn `unreadable-report` into `no-report` and lose a
    // distinction the verdict is careful to draw.
    const { raw, stale } = refineReportText('{ not json', () => SOURCE);

    expect(raw).toBe('{ not json');
    expect(stale).toEqual([]);
  });

  it('passes absent text through as absent', () => {
    expect(refineReportText(undefined, () => SOURCE).raw).toBeUndefined();
  });
});

describe('describing a stale marker', () => {
  it('names the file, the line, the mutator and the replacement that no longer match', () => {
    const { stale } = applyRecordedSurvivors(
      report({ 'a.ts': { mutants: [mutant({ status: 'Killed' })] } }),
      () => SOURCE,
    );

    const described = describeStale(stale);

    expect(described).toContain('a.ts:2');
    expect(described).toContain('ConditionalExpression');
    expect(described).toContain('true');
  });

  it('says nothing when nothing is stale', () => {
    expect(describeStale([])).toBe('');
  });
});

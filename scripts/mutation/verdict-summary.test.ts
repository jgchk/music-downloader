import { describe, expect, it } from 'vitest';
import type { MutationReport, ReportedMutant } from './report-model.ts';
import { decideVerdict, readEnforcement, type Verdict } from './verdict.ts';
import { renderVerdict } from './verdict-summary.ts';

/**
 * What the step summary tells a reader the verdict decided, and why.
 *
 * Under shadow this text is the whole product: the job's conclusion does not move, so a reader who
 * cannot tell "clean" from "would have blocked" from "nothing was audited" is reading a channel with
 * no consumer — the attested-dead shape this change exists to escape. Under enforcement the same
 * text is what the loop acts on, and a finding whose fix is not obvious from its own report is one
 * that gets appeased instead of fixed (quality-gates.md).
 */

const mutant = (
  start: number,
  end: number,
  overrides: Partial<ReportedMutant> = {},
): ReportedMutant => ({
  mutatorName: 'ConditionalExpression',
  status: 'Survived',
  location: { start: { line: start }, end: { line: end } },
  replacement: 'true',
  ...overrides,
});

const report = (files: MutationReport['files']): string => JSON.stringify({ files });

const DIFF = ['+++ packages/importer/src/domain/import/decide.ts', '@@ -20 +20 @@', '+edited'].join(
  '\n',
);

const SHADOW = { reading: readEnforcement(undefined), strykerSeconds: undefined };
const ENFORCING = { reading: readEnforcement('true'), strykerSeconds: undefined };

const FILE = 'packages/importer/src/domain/import/decide.ts';

function verdictFor(files: MutationReport['files']): Verdict {
  return decideVerdict({ report: report(files), diff: DIFF });
}

describe('a blocking finding', () => {
  const blocking = verdictFor({ [FILE]: { mutants: [mutant(20, 20)] } });

  it('names the file, the line and the mutation in a table', () => {
    const summary = renderVerdict(blocking, SHADOW);

    expect(summary).toContain(FILE);
    expect(summary).toContain('| 20 |');
    expect(summary).toContain('ConditionalExpression');
    expect(summary).toContain('true');
  });

  it('says the shadow verdict WOULD have blocked, and that the job is not failing on it', () => {
    const summary = renderVerdict(blocking, SHADOW);

    expect(summary).toMatch(/would have blocked/i);
    expect(summary).toContain('MUTATION_GATE_ENFORCE');
    expect(summary).toMatch(/not fail/i);
  });

  it('says the branch IS blocked once enforcing, without the shadow hedge', () => {
    const summary = renderVerdict(blocking, ENFORCING);

    expect(summary).not.toMatch(/would have blocked/i);
    expect(summary).toMatch(/blocks this branch/i);
  });

  it('marks how many further survivors sit on the same line', () => {
    const folded = verdictFor({
      [FILE]: { mutants: [mutant(20, 20), mutant(20, 20, { replacement: 'false' })] },
    });

    expect(renderVerdict(folded, SHADOW)).toContain('+1');
  });
});

describe('a clean verdict', () => {
  it('says no survivor sits on a changed line, and is not mistakable for a finding', () => {
    const clean = verdictFor({
      [FILE]: { mutants: [mutant(1, 1, { status: 'Killed' }), mutant(90, 95)] },
    });
    const summary = renderVerdict(clean, SHADOW);

    expect(summary).toMatch(/no surviving mutant/i);
    expect(summary).not.toMatch(/would have blocked/i);
    expect(summary).not.toMatch(/audited nothing|nothing was audited/i);
  });

  it('still reports the survivors it saw off the diff, so the wide signal is not lost', () => {
    // "Suppress the gate, never the feedback": the reporting scope stays the changed FILES even
    // though the failure scope is the changed lines, so a survivor elsewhere in a touched file is
    // still visible — as information, not as a block.
    const clean = verdictFor({
      [FILE]: { mutants: [mutant(1, 1, { status: 'Killed' }), mutant(90, 95)] },
    });

    expect(renderVerdict(clean, SHADOW)).toMatch(/1 surviving mutant.*not block/is);
  });
});

describe('a run that cannot be graded', () => {
  it('says the run wrote no report at all', () => {
    const summary = renderVerdict(decideVerdict({ report: undefined, diff: DIFF }), SHADOW);

    expect(summary).toMatch(/no report/i);
    expect(summary).not.toMatch(/no surviving mutant/i);
  });

  it('says the report exists but could not be read, which is a different fault', () => {
    const summary = renderVerdict(decideVerdict({ report: '{ "files": ', diff: DIFF }), SHADOW);

    expect(summary).toMatch(/could not (be )?read/i);
    expect(summary).not.toMatch(/no report was written|wrote no report/i);
  });

  it('says a scope that produced no mutants audited nothing', () => {
    const summary = renderVerdict(verdictFor({ [FILE]: { mutants: [] } }), SHADOW);

    expect(summary).toMatch(/no mutants at all/i);
    expect(summary).not.toMatch(/no surviving mutant/i);
  });

  it('says a scope whose mutants were all ignored audited nothing', () => {
    const summary = renderVerdict(
      verdictFor({ [FILE]: { mutants: [mutant(20, 20, { status: 'Ignored' })] } }),
      SHADOW,
    );

    expect(summary).toMatch(/every mutant .* ignored/i);
  });

  it('names the path-spelling drift when the report and the diff do not join', () => {
    // The silent-green hazard has to be READABLE, not just caught: a reader who sees "unaudited"
    // and no cause will re-run the job and see it again.
    const summary = renderVerdict(
      decideVerdict({ report: report({ 'a.ts': { mutants: [mutant(20, 20)] } }), diff: DIFF }),
      SHADOW,
    );

    expect(summary).toMatch(/matched no file|did not match/i);
    expect(summary).toMatch(/path/i);
  });

  it('tells the three refusals apart in words, not only in kind', () => {
    const sentences = [
      renderVerdict(decideVerdict({ report: undefined, diff: DIFF }), SHADOW),
      renderVerdict(decideVerdict({ report: 'nope', diff: DIFF }), SHADOW),
      renderVerdict(verdictFor({ [FILE]: { mutants: [] } }), SHADOW),
    ];

    expect(new Set(sentences).size).toBe(3);
  });
});

describe('the Stryker step duration', () => {
  const clean = verdictFor({ [FILE]: { mutants: [mutant(1, 1, { status: 'Killed' })] } });

  it('reports how long the run took, so the tuning lever has a number behind it', () => {
    // design D2/D6: variant (B) — range-scoping the run — is the recorded lever, and it should be
    // pulled on a measurement rather than on irritation.
    expect(renderVerdict(clean, { ...SHADOW, strykerSeconds: 796 })).toContain('13m16s');
  });

  it('names the lever once the run passes the threshold that would trigger it', () => {
    expect(renderVerdict(clean, { ...SHADOW, strykerSeconds: 16 * 60 })).toMatch(/--mutate/);
    expect(renderVerdict(clean, { ...SHADOW, strykerSeconds: 60 })).not.toMatch(/--mutate/);
  });

  it('says nothing about duration when the step never reported one', () => {
    expect(renderVerdict(clean, SHADOW)).not.toMatch(/Stryker step/i);
  });
});

describe('an enforcement switch nobody recognises', () => {
  it('says the value was ignored and that the gate stayed in shadow', () => {
    const clean = verdictFor({ [FILE]: { mutants: [mutant(1, 1, { status: 'Killed' })] } });
    const summary = renderVerdict(clean, {
      reading: readEnforcement('yes'),
      strykerSeconds: undefined,
    });

    expect(summary).toContain('yes');
    expect(summary).toMatch(/not recognised|unrecognised/i);
  });
});

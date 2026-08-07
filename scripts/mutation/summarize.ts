import {
  byPath,
  isSurviving,
  isUnclassified,
  type MutationReport,
  readReport,
  type ReportedMutant,
} from './report-model.ts';

/**
 * Renders the mutation run's findings for a CI job summary (change: mutation-gate).
 *
 * Pass/fail is Stryker's, not this file's: the run breaks on its own threshold, so a defect here
 * costs a worse explanation, never a wrong verdict. What it owes the reader is the Google recipe's
 * surfacing rule — **at most one mutant per line**. One weak assertion routinely spawns a dozen
 * mutants on the same line; printing all twelve turns one thing to do into a wall to scroll past,
 * and a finding people scroll past counts as false under the admission contract
 * (`docs/development/quality-gates.md`).
 *
 * The model, the survivorship policy, and the reader live in `report-model.ts`; this module is one
 * of its two presenters (`drift.ts` is the other).
 */

interface Finding {
  readonly file: string;
  readonly line: number;
  readonly mutant: ReportedMutant;
  /** How many further surviving mutants sit on this same line, folded into this row. */
  readonly folded: number;
}

/** Markdown table cells cannot carry a pipe or a newline. */
export function cell(text: string): string {
  return text.replaceAll('|', String.raw`\|`).replaceAll('\n', ' ');
}

/** The surviving mutants of one file, grouped by the line they sit on, in line order. */
function survivorsByLine(mutants: readonly ReportedMutant[]): Map<number, ReportedMutant[]> {
  const byLine = new Map<number, ReportedMutant[]>();
  const surviving = mutants.filter((mutant) => isSurviving(mutant));
  for (const mutant of surviving) {
    const line = mutant.location.start.line;
    byLine.set(line, [...(byLine.get(line) ?? []), mutant]);
  }
  return new Map([...byLine].toSorted(([left], [right]) => left - right));
}

/** One finding per surviving line of one file — the rest of that line's mutants are counted. */
function findingsIn(file: string, mutants: readonly ReportedMutant[]): Finding[] {
  return [...survivorsByLine(mutants)].flatMap(([line, onLine]) => {
    // The first mutant Stryker reported on the line stands for all of them. A line is only in the
    // map because a mutant was put there, so the empty case is unreachable — narrowed rather than
    // asserted away, so an empty group would drop a row instead of crashing the summary.
    const [first, ...rest] = onLine;
    return first === undefined ? [] : [{ file, line, mutant: first, folded: rest.length }];
  });
}

/** One finding per surviving line, in file then line order; the rest are counted, not printed. */
function findings(report: MutationReport): Finding[] {
  return Object.keys(report.files)
    .toSorted(byPath)
    .flatMap((file) => findingsIn(file, report.files[file]?.mutants ?? []));
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

const HEADING = '## Mutation gate';

/**
 * The summary from the raw report text a run wrote, tolerating every way there is no report to
 * read. Each is said out loud rather than folded into the clean-run wording: a crashed, wedged, or
 * unrecognisable run must not print "no surviving mutants" underneath a red job, which is the one
 * summary that would actively mislead.
 */
export function summarizeReport(raw: string | undefined): string {
  if (raw === undefined) {
    return `${HEADING}\n\nThe run produced no report — it failed before it could write one. Read the job log above.\n`;
  }
  const report = readReport(raw);
  if (report === undefined) {
    return `${HEADING}\n\nThe run wrote a report this summarizer could not read — malformed JSON, or a shape it does not recognise (a Stryker upgrade?). Read the job log above.\n`;
  }
  return summarizeSurvivors(report);
}

interface Counted {
  readonly files: number;
  readonly mutants: number;
  readonly ignored: number;
  readonly unclassified: readonly string[];
}

function count(report: MutationReport): Counted {
  const mutants = Object.values(report.files).flatMap((file) => [...file.mutants]);
  return {
    files: Object.keys(report.files).length,
    mutants: mutants.length,
    ignored: mutants.filter((mutant) => mutant.status === 'Ignored').length,
    unclassified: [
      ...new Set(mutants.filter((mutant) => isUnclassified(mutant)).map((m) => m.status)),
    ].toSorted(byPath),
  };
}

/**
 * A line for statuses this tooling has no rule for. Silence about them is how the weekly channel
 * would go quiet after a Stryker upgrade renamed a status — the run stays green and simply stops
 * finding anything.
 */
function unclassifiedNote(counted: Counted): readonly string[] {
  if (counted.unclassified.length === 0) return [];
  return [
    '',
    `> **${plural(counted.unclassified.length, 'status')} in this report are unknown to the summarizer** (${counted.unclassified.join(', ')}).`,
    '> They are counted as neither surviving nor detected. Teach `report-model.ts` about them.',
  ];
}

/** Markdown for a job summary: a headline, then one row per surviving line. */
export function summarizeSurvivors(report: MutationReport): string {
  const rows = findings(report);
  const counted = count(report);

  if (rows.length === 0) {
    return [
      HEADING,
      '',
      // The counts are the point: "clean" and "nothing was analysed" must not read the same. A
      // scope that resolved to no mutants, or a file whose mutants were all ignored, is not a
      // file this gate audited — and the sentence used to claim it was.
      `Analysed **${plural(counted.mutants, 'mutant')}** across **${plural(counted.files, 'file')}**` +
        (counted.ignored > 0 ? ` (${counted.ignored} ignored — arid or static)` : '') +
        '.',
      '',
      counted.mutants === 0
        ? 'The scope produced no mutants at all, so nothing was audited.'
        : counted.mutants === counted.ignored
          ? 'Every mutant here was ignored, so nothing in this scope was actually audited.'
          : 'No surviving mutants.',
      ...unclassifiedNote(counted),
      '',
    ].join('\n');
  }

  const total = rows.reduce((sum, row) => sum + 1 + row.folded, 0);
  return [
    HEADING,
    '',
    `**${plural(total, 'surviving mutant')} on ${plural(rows.length, 'line')}**, out of ${plural(counted.mutants, 'mutant')} across ${plural(counted.files, 'file')}.`,
    'Kill each one with a test that notices the change, or suppress it as arid with an inline',
    'justification (`// Stryker disable next-line <mutator>: <reason>`).',
    '',
    'At most one mutant is shown per line; a line with more is marked, and killing the shown one',
    'usually kills its siblings.',
    ...unclassifiedNote(counted),
    '',
    '| File | Line | Status | Mutator | Replacement | Also on line |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows.map((row) => {
      const also = row.folded === 0 ? '—' : `+${row.folded}`;
      // `NoCoverage` and `Survived` are different jobs for the reader: the first means no test
      // reaches the line at all, the second that tests reach it and none notices the change.
      return `| \`${row.file}\` | ${row.line} | ${row.mutant.status} | ${row.mutant.mutatorName} | \`${cell(row.mutant.replacement ?? '')}\` | ${also} |`;
    }),
    '',
  ].join('\n');
}

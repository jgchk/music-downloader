import { byPath, isSurviving, type MutationReport, type ReportedMutant } from './report-model.ts';
import { cell } from './markdown.ts';

/**
 * Turns the weekly full run's report into tracker issues (change: mutation-gate).
 *
 * The PR gate speaks at change time, which is the strongest seat an analyzer can have. Nothing
 * speaks for code no PR touches — assertion strength there erodes silently as the code around it
 * moves. The weekly run is that voice, and because it has no diff to attach to, it files issues.
 * It blocks nothing: a scheduled job that could redden main would be a gate nobody could land
 * through, and the finding is real but not urgent.
 *
 * Clustered per file, and titled by file alone. The title is the dedupe key the workflow searches
 * on, so it must be stable while the drift persists — a title carrying the mutant count would file
 * a new issue every week for the same untouched module, which is how a tracker channel becomes
 * noise and stops being read.
 */

export interface DriftIssue {
  readonly title: string;
  readonly body: string;
}

export const DRIFT_LABEL = 'mutation-drift';

function titleFor(file: string): string {
  return `mutation drift: ${file}`;
}

function bodyFor(file: string, survivors: readonly ReportedMutant[]): string {
  return [
    `The weekly full mutation run found ${survivors.length} surviving mutant(s) in \`${file}\`.`,
    '',
    'Each one is a change to production code that the whole suite failed to notice. Kill it with a',
    'test that asserts the behavior, or — if the code is genuinely arid — suppress it at the site',
    'with a written justification (`// Stryker disable next-line <mutator>: <reason>`).',
    '',
    'This issue blocks nothing. The weekly run dedupes on this exact title against OPEN issues, so',
    'it stays a single issue while the drift persists — and closing it without a fix files a fresh',
    'one next week rather than reopening this one.',
    '',
    '| Line | Status | Mutator | Replacement |',
    '| --- | --- | --- | --- |',
    ...survivors.map(
      (mutant) =>
        `| ${mutant.location.start.line} | ${mutant.status} | ${mutant.mutatorName} | \`${cell(mutant.replacement ?? '')}\` |`,
    ),
    '',
    // NOT `pnpm test:mutation`: that passes --incremental, whose report merges cached whole-repo
    // results, so it would report the other files' survivors too (design D4a).
    `Reproduce locally: \`pnpm exec stryker run --mutate '${file}'\``,
    '',
  ].join('\n');
}

/** One issue per file that still has a surviving mutant, in file order. */
export function driftIssues(report: MutationReport): DriftIssue[] {
  const issues: DriftIssue[] = [];
  for (const file of Object.keys(report.files).toSorted(byPath)) {
    const survivors = (report.files[file]?.mutants ?? [])
      .filter((mutant) => isSurviving(mutant))
      .toSorted((left, right) => left.location.start.line - right.location.start.line);
    if (survivors.length === 0) continue;
    issues.push({ title: titleFor(file), body: bodyFor(file, survivors) });
  }
  return issues;
}

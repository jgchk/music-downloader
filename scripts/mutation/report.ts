import { existsSync, readFileSync } from 'node:fs';
import { REPORT_PATH } from './report-model.ts';
import { summarizeReport } from './summarize.ts';

/**
 * Print the mutation run's findings as Markdown, for the CI job to append to its step summary.
 *
 *   pnpm tsx scripts/mutation/report.ts [report.json] >> "$GITHUB_STEP_SUMMARY"
 *
 * Never decides pass/fail. `verdict.ts` does that, via `pr-verdict.ts` in the step after this one:
 * the failure scope is the changed LINES, while this summary's scope is the changed FILES. The two
 * are deliberately different — a wide report under a narrow gate is strictly more information, and
 * "suppress the gate, never the feedback" is the whole reason this file still prints everything.
 *
 * (It used to say Stryker's exit code decides. It did, until `thresholds.break: 100` — "any survivor
 * anywhere in the reporting scope" — stopped being the verdict the job wanted.)
 *
 * So this only explains, and it prints a summary for every outcome including the ones where there is
 * no report at all.
 */
const reportPath = process.argv[2] ?? REPORT_PATH;

process.stdout.write(
  summarizeReport(existsSync(reportPath) ? readFileSync(reportPath, 'utf8') : undefined),
);

import { existsSync, readFileSync } from 'node:fs';
import { REPORT_PATH } from './report-model.ts';
import { summarizeReport } from './summarize.ts';

/**
 * Print the mutation run's findings as Markdown, for the CI job to append to its step summary.
 *
 *   pnpm tsx scripts/mutation/report.ts [report.json] >> "$GITHUB_STEP_SUMMARY"
 *
 * Never decides pass/fail — Stryker's exit code does that. This only explains it, so it prints a
 * summary for every outcome including the ones where there is no report at all.
 */
const reportPath = process.argv[2] ?? REPORT_PATH;

process.stdout.write(
  summarizeReport(existsSync(reportPath) ? readFileSync(reportPath, 'utf8') : undefined),
);

import { existsSync, readFileSync } from 'node:fs';
import { driftIssues } from './drift.ts';
import { applyRecordedSurvivors, describeStale, readSourceFromDisk } from './recorded-survivors.ts';
import { readReport, REPORT_PATH } from './report-model.ts';

/**
 * Print the weekly run's drift issues as a JSON array, for the scheduled workflow to file with
 * `gh issue create` (deduping by title).
 *
 *   pnpm tsx scripts/mutation/file-drift.ts [report.json]
 *
 * Prints `[]` when there is genuinely no report — the run died before writing one, which the
 * workflow step before this one already fails on. But a report that EXISTS and cannot be read is a
 * different thing: printing `[]` for it would file nothing, log `drift clusters: 0`, and leave a
 * green weekly run indistinguishable from a clean repo. That case exits non-zero instead, because
 * the drift channel going silent is exactly the failure this job exists to prevent.
 *
 * Recorded survivors (change: mutation-recorded-survivors) are subtracted here, at the I/O edge,
 * because that is where reading source files belongs — `drift.ts` stays a pure function over a
 * report. This is the run that rechecks every marker in the repo: it is the only one that mutates
 * every file, so a waiver whose argument has expired can be caught nowhere else. That check fails
 * the step rather than filing an issue, because a stale waiver is a hole in the gate, not drift.
 */
const reportPath = process.argv[2] ?? REPORT_PATH;

const raw = existsSync(reportPath) ? readFileSync(reportPath, 'utf8') : undefined;
const parsed = readReport(raw);

if (raw !== undefined && parsed === undefined) {
  process.stderr.write(
    `${reportPath} exists but could not be read as a mutation report — truncated, or a shape this tooling does not recognise. Refusing to report zero drift.\n`,
  );
  process.exitCode = 1;
} else if (parsed === undefined) {
  process.stdout.write(JSON.stringify([]));
} else {
  const { report, stale } = applyRecordedSurvivors(parsed, readSourceFromDisk);
  if (stale.length > 0) {
    process.stderr.write(`${describeStale(stale)}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(JSON.stringify(driftIssues(report)));
  }
}

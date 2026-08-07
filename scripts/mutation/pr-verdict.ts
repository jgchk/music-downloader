import { readFileSync } from 'node:fs';
import { REPORT_PATH } from './report-model.ts';
import { renderVerdict } from './verdict-summary.ts';
import {
  decideVerdict,
  ENFORCE_SWITCH,
  exitCodeFor,
  isBlocking,
  readEnforcement,
} from './verdict.ts';

/**
 * Decide the mutation gate's changed-line verdict and print it as Markdown, for the PR job to append
 * to its step summary (change: mutation-gate-diff-scope).
 *
 *   pnpm tsx scripts/mutation/pr-verdict.ts <changed.diff> [report.json] >> "$GITHUB_STEP_SUMMARY"
 *
 * This step, and NOT the Stryker step, is where the job's decision lives. `thresholds.break: 100`
 * makes Stryker exit non-zero for any survivor anywhere in the file-wide reporting scope, which is
 * exactly the verdict design D1 rejects — so `continue-on-error` stays on that step and this one
 * carries no such flag. Shipped in shadow: the exit code is 0 whatever the verdict until
 * `MUTATION_GATE_ENFORCE` says otherwise (design D3).
 *
 * The thin end of the wedge, like `report.ts` and `file-drift.ts`: it reads two files, prints, and
 * sets an exit code. `verdict.ts` decides and `verdict-summary.ts` explains; both are pure, and both
 * are tested without a process.
 */

const diffPath = process.argv[2];
const reportPath = process.argv[3] ?? REPORT_PATH;

/**
 * Absent OR unopenable, as one value. `readFileSync` throws on a directory, on a permission fault,
 * and on a race with any prior existence check — and an escaping throw here would exit non-zero
 * BEFORE anything reached the step summary. This step deliberately carries no `continue-on-error`,
 * so that is a shadow-mode gate failing the PR with a stack trace and no verdict: the one thing
 * shadow mode is defined not to do. The catch is held tight against the vendor call and converts
 * only it; what the content turns out to be is `verdict.ts`'s judgement, not this function's.
 */
const read = (path: string | undefined): string | undefined => {
  if (path === undefined) return undefined;
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
};

const verdict = decideVerdict({ report: read(reportPath), diff: read(diffPath) });
const reading = readEnforcement(process.env[ENFORCE_SWITCH]);

// A duration the job could not measure is absent rather than zero: "the step took no time" and "no
// one timed the step" are different claims, and only one of them is true.
const seconds = Number(process.env.MUTATION_STRYKER_SECONDS);
const strykerSeconds = Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;

process.stdout.write(renderVerdict(verdict, { reading, strykerSeconds }));

// stdout is redirected into the step summary, so workflow commands there would be rendered rather
// than read. The log gets the one-line reason instead, and it is written for BOTH modes: a shadow
// verdict nobody can find in the log is the advisory channel with no consumer all over again.
if (isBlocking(verdict)) {
  const prefix = reading.enforcement === 'enforce' ? 'Blocking' : 'Would block (shadow)';
  // The REASON, not just the kind: `no-mutants`, `all-ignored`, `no-file-joined` and `no-diff` all
  // print as `unaudited` otherwise, and those are the conditions whose frequency task 5.1 has to
  // count. Reading them out of every green PR's step summary by hand is how that measurement
  // quietly never happens.
  const detail = verdict.kind === 'unaudited' ? ` (${verdict.reason})` : '';
  process.stderr.write(`${prefix}: mutation verdict is \`${verdict.kind}\`${detail}.\n`);
}

process.exitCode = exitCodeFor(verdict, reading.enforcement);

import {
  type ChangedLines,
  isOnChangedLine,
  type LineRange,
  parseChangedLines,
} from './changed-lines.ts';
import {
  type AuditGap,
  auditGap,
  byPath,
  type Counted,
  countMutants,
  isSurviving,
  type MutationReport,
  readReport,
  type ReportedMutant,
} from './report-model.ts';

/**
 * The mutation gate's verdict (change: mutation-gate-diff-scope).
 *
 * This is the one module in `scripts/mutation/` that decides. `summarize.ts` and `drift.ts` explain
 * a run; a defect in either costs a worse paragraph. A defect here costs a wrong gate — so the
 * decision is a pure function over two texts (the report Stryker wrote, the diff git wrote) that
 * returns the verdict AS A VALUE. No I/O, no `process.exit`, no throwing: `pr-verdict.ts` reads the
 * files, `verdict-summary.ts` renders, and this decides.
 *
 * The gate's REPORTING scope is the changed files and stays that way — a wide report under a narrow
 * gate is strictly more information, and Android lint's rule is "suppress the gate, never the
 * feedback". Its FAILURE scope is the changed lines, because the alternative fails a branch for debt
 * it did not create, and a red check nobody can act on is one the loop learns to ignore.
 *
 * Once enforcing, four things fail — the fourth folded into the third because it has the same cause
 * and the same remedy:
 *
 *   1. a surviving mutant whose span overlaps a line the branch added or modified;
 *   2. a missing or unreadable report — a crashed run must never read as a green gate;
 *   3. a scope in which no mutant was actually analysed (none generated, or every one ignored);
 *   4. a report and a diff whose path spellings do not join, which produces no findings for the
 *      same reason an empty scope does: nothing was measured. This is the most dangerous outcome
 *      available because it is shaped exactly like success (design D4).
 *
 * None of 2 or 3 is new machinery. `readReport` already models every way there is no report, and
 * `summarizeSurvivors` already distinguished an unmeasured scope from a clean one — `auditGap` is
 * that distinction lifted into the model so both presenters and this decider read one answer. This
 * module ACTS on what they DETECT.
 */

/** One blocking finding: a survivor on a changed line, standing for the rest of its line. */
export interface VerdictFinding {
  readonly file: string;
  readonly line: number;
  readonly mutant: ReportedMutant;
  /** How many further survivors on this same line are folded into this one (design D8). */
  readonly folded: number;
}

/**
 * Why a run cannot be graded at all. Every one is a refusal, never a pass-through — and each earns
 * its own sentence, because "unaudited" with no cause gets re-run rather than fixed.
 */
export type UnauditedReason = AuditGap | 'no-file-joined' | 'no-diff';

export type Verdict =
  | {
      readonly kind: 'findings';
      readonly findings: readonly VerdictFinding[];
      readonly counted: Counted;
      readonly reportedSurvivors: number;
    }
  | { readonly kind: 'clean'; readonly counted: Counted; readonly reportedSurvivors: number }
  | { readonly kind: 'no-report' }
  | { readonly kind: 'unreadable-report' }
  | {
      readonly kind: 'unaudited';
      readonly reason: UnauditedReason;
      readonly counted: Counted;
      /** The report files that matched nothing in the diff — the evidence for `no-file-joined`. */
      readonly unjoined?: readonly string[];
    };

export interface VerdictInput {
  /** The raw text of Stryker's JSON report, or `undefined` when the run wrote none. */
  readonly report: string | undefined;
  /**
   * The raw text of `git diff` run with `changed-lines.ts`'s `DIFF_FLAGS` over the same merge-base,
   * or `undefined` when the job wrote none. Absence is modelled here rather than flattened to `''`
   * by the caller: "the diff was never produced" and "the report and the diff do not join" are
   * different faults with different remedies, and telling someone their path spellings drifted when
   * a shell step actually aborted sends them to debug code that is fine.
   */
  readonly diff: string | undefined;
}

/**
 * Repo-relative POSIX, on both sides of the join.
 *
 * Stryker keys its report with `normalizeFileName(path.relative(process.cwd(), fileName))` — POSIX
 * separators, relative to the directory the run started in, which in CI is the repo root. Git under
 * `--no-prefix` prints the same shape. They are still normalised rather than trusted to match,
 * because if they ever stop matching the failure is invisible: no exception, no empty file list,
 * just a gate that finds nothing forever.
 */
function normalisePath(file: string): string {
  return file.replaceAll('\\', '/').replace(/^\.\//, '');
}

function normaliseKeys(changed: ChangedLines): ChangedLines {
  return new Map([...changed].map(([file, ranges]) => [normalisePath(file), ranges]));
}

/**
 * The lines a mutant occupies, reading Stryker's END AS EXCLUSIVE — its schema says so in as many
 * words: *"A location with start and end. Start is inclusive, end is exclusive."* A span ending at
 * column 1 stops before that line, so reading it as inclusive would gate one line more than the
 * mutant covers. That is a false positive, and false positives are the currency the ten-percent
 * admission bar is counted in.
 */
function spanOf(mutant: ReportedMutant): LineRange {
  const start = mutant.location.start.line;
  const { line, column } = mutant.location.end;
  return { start, end: column === 1 ? Math.max(start, line - 1) : line };
}

/** Every surviving mutant of the report whose span overlaps a line the branch wrote. */
function survivorsOnChangedLines(
  report: MutationReport,
  changed: ChangedLines,
): readonly { readonly file: string; readonly mutant: ReportedMutant }[] {
  return Object.keys(report.files)
    .toSorted(byPath)
    .flatMap((file) => {
      const ranges = changed.get(normalisePath(file));
      return (report.files[file]?.mutants ?? [])
        .filter((mutant) => isSurviving(mutant) && isOnChangedLine(ranges, spanOf(mutant)))
        .map((mutant) => ({ file, mutant }));
    });
}

/**
 * At most one finding per line, the rest counted — `summarize.ts`'s surfacing rule applied to the
 * FAILING set as well as the reported one, so the two agree about what a line costs. Keyed on the
 * mutant's own start line, which is the key `summarize.ts` groups by; TSE 2021 found that in more
 * than 90% of cases every mutant on a line is killed or every one survives, so the first stands for
 * the rest and killing it usually kills them.
 */
function foldPerLine(
  survivors: readonly { readonly file: string; readonly mutant: ReportedMutant }[],
): readonly VerdictFinding[] {
  const byLine = new Map<string, VerdictFinding>();
  for (const { file, mutant } of survivors) {
    const line = mutant.location.start.line;
    const key = `${file}:${line}`;
    const seen = byLine.get(key);
    byLine.set(
      key,
      seen === undefined ? { file, line, mutant, folded: 0 } : { ...seen, folded: seen.folded + 1 },
    );
  }
  return byLine
    .values()
    .toArray()
    .toSorted((left, right) => byPath(left.file, right.file) || left.line - right.line);
}

/** How many survivors the run reported anywhere in its (file-wide) scope, blocking or not. */
function countSurvivors(report: MutationReport): number {
  return Object.values(report.files)
    .flatMap((file) => [...file.mutants])
    .filter((mutant) => isSurviving(mutant)).length;
}

/**
 * The verdict, as a value. Refusals are checked before findings because each of them means the
 * finding set carries no information: an empty result from an unmeasured scope is not a clean one.
 */
export function decideVerdict(input: VerdictInput): Verdict {
  if (input.report === undefined) return { kind: 'no-report' };

  const report = readReport(input.report);
  if (report === undefined) return { kind: 'unreadable-report' };

  const counted = countMutants(report);
  const gap = auditGap(counted);
  if (gap !== undefined) return { kind: 'unaudited', reason: gap, counted };

  if (input.diff === undefined) return { kind: 'unaudited', reason: 'no-diff', counted };

  const changed = normaliseKeys(parseChangedLines(input.diff));
  if (changed.size === 0) return { kind: 'unaudited', reason: 'no-diff', counted };

  // EVERY file in the report must join, not merely one. The report's files come from `--mutate`,
  // handed the same changed-file list the diff is cut over, so report ⊆ diff always holds: a file
  // that fails to join means a spelling this join does not understand, and its mutants would be
  // dropped from the failure scope with no trace. `some` clears the whole run on one file matching.
  const unjoined = Object.keys(report.files)
    .filter((file) => !changed.has(normalisePath(file)))
    .toSorted(byPath);
  if (unjoined.length > 0) {
    return { kind: 'unaudited', reason: 'no-file-joined', counted, unjoined };
  }

  const reportedSurvivors = countSurvivors(report);
  const findings = foldPerLine(survivorsOnChangedLines(report, changed));
  return findings.length === 0
    ? { kind: 'clean', counted, reportedSurvivors }
    : { kind: 'findings', findings, counted, reportedSurvivors };
}

/**
 * Would this verdict fail the job, were the gate enforcing?
 *
 * A table rather than `kind !== 'clean'`. The negation form is a `default:` arm wearing a minus
 * sign: it compiles for a variant nobody has classified and silently calls it blocking. `satisfies`
 * makes a new variant a BUILD BREAK here, so the next arm's side is a decision somebody made rather
 * than one it inherited — and the plausible next arms are the passing ones.
 */
const BLOCKING = {
  findings: true,
  clean: false,
  'no-report': true,
  'unreadable-report': true,
  unaudited: true,
} satisfies Record<Verdict['kind'], boolean>;

export function isBlocking(verdict: Verdict): boolean {
  return BLOCKING[verdict.kind];
}

/** The environment variable that turns the shadow verdict into a blocking one. */
export const ENFORCE_SWITCH = 'MUTATION_GATE_ENFORCE';

/**
 * Shadow computes and publishes; enforce additionally fails. One switch, read at the entrypoint,
 * changing the exit code and the wording that reports it — never the DECISION — so the shadow
 * measurement (task 5.1) measures the enforcing logic rather than a different program.
 */
export type Enforcement = 'shadow' | 'enforce';

/**
 * Correlated, so `enforce` cannot carry an ignored value: `{ enforcement: 'enforce', unrecognised:
 * 'yes' }` would render "**Enforcing.**" directly above "it was ignored and the gate stayed in
 * shadow".
 */
export type SwitchReading =
  | { readonly enforcement: 'enforce' }
  | {
      readonly enforcement: 'shadow';
      /** A value neither on nor off, carried so the summary can say it was ignored. */
      readonly unrecognised?: string;
    };

const ENABLED = new Set(['true', '1']);
const DISABLED = new Set(['', 'false', '0']);

/**
 * Shadow is the shipped state, so shadow is what anything other than an explicit enable means. A
 * value that is neither — `yes`, `on`, a typo — is reported rather than silently obeyed: a switch
 * believed to be flipped that quietly is not would make the whole measurement a fiction, and this is
 * the cheapest place to notice.
 */
export function readEnforcement(raw: string | undefined): SwitchReading {
  const value = (raw ?? '').trim().toLowerCase();
  if (ENABLED.has(value)) return { enforcement: 'enforce' };
  return DISABLED.has(value)
    ? { enforcement: 'shadow' }
    : { enforcement: 'shadow', unrecognised: raw };
}

/** The process exit code this verdict earns under this enforcement state. */
export function exitCodeFor(verdict: Verdict, enforcement: Enforcement): number {
  return enforcement === 'enforce' && isBlocking(verdict) ? 1 : 0;
}

import type { schema } from '@stryker-mutator/api/core';

/**
 * How this repo's tooling reads a StrykerJS mutation report (change: mutation-gate).
 *
 * One module for the model — the shape, the survivorship policy, and the reader — so the PR summary
 * (`summarize.ts`) and the weekly drift channel (`drift.ts`) are two peers over it rather than one
 * depending on the other's renderer. The policy below is the only *decision* in this tooling, and it
 * is the thing both consumers must agree on.
 *
 * This is a vendor boundary: Stryker is an independently-versioned dependency that Renovate bumps,
 * and its report arrives as untyped JSON from another process. So the model is a tolerant reader —
 * only the fields actually used are declared — but a tolerant reader still has to *parse*, not
 * assume. `readReport` is the one door.
 */

/**
 * A mutant is a sub-expression, not a line — a `BlockStatement` removal spans a whole function —
 * so BOTH ends of the span are read. The changed-line verdict intersects that span with the diff's
 * hunks for *overlap*, and a model carrying only `start` would collapse every block mutant onto one
 * line and stop overlapping the hunks it encloses.
 */
export interface ReportedMutant {
  readonly mutatorName: string;
  readonly status: string;
  readonly location: {
    readonly start: { readonly line: number };
    /**
     * `column` is read because Stryker's schema says **"Start is inclusive, end is exclusive"**. An
     * end at column 1 therefore stops *before* that line, and reading the span as inclusive would
     * gate one line more than the mutant occupies — a false positive, which is the direction the
     * ten-percent admission bar is measured in.
     */
    readonly end: { readonly line: number; readonly column: number };
  };
  readonly replacement?: string;
}

export interface MutationReport {
  readonly files: Readonly<Record<string, { readonly mutants: readonly ReportedMutant[] }>>;
}

/**
 * The tolerant view must stay a structural subset of Stryker's own report type. A vendor bump that
 * renames `mutatorName`, `replacement`, or `location.start.line` stops compiling HERE — instead of
 * turning every cell of the summary table into `undefined` while every test stays green, which is
 * exactly what would happen otherwise: the fixtures are built from *our* type, so they could never
 * notice the vendor moving.
 */
export type IsVendorReportAssignable = schema.MutationTestResult extends MutationReport
  ? true
  : never;

/**
 * ...and the alias has to be CONSUMED to mean anything. `type X = A extends B ? true : never` is a
 * perfectly legal declaration when the answer is `never`; nothing errors, so an unread alias asserts
 * exactly nothing and the comment above it would be a promise the compiler never made. Assigning
 * `true` to it is what turns vendor drift into the build break this file claims.
 */
const IS_VENDOR_REPORT_ASSIGNABLE: IsVendorReportAssignable = true;
void IS_VENDOR_REPORT_ASSIGNABLE;

/**
 * `status` stays an open `string` on the interface — a tolerant reader must not fail to *parse* a
 * status a future Stryker adds. The literals it is compared against are a different matter: they are
 * the load-bearing values of the whole gate, so they are checked against the vendor's own union and
 * a renamed status becomes a build break at the dependency bump.
 */
const SURVIVING = ['Survived', 'NoCoverage'] as const satisfies readonly schema.MutantStatus[];

const DETECTED = [
  'Killed',
  'Timeout',
  'Ignored',
  'CompileError',
  'RuntimeError',
] as const satisfies readonly schema.MutantStatus[];

/**
 * A mutant is a finding when no test noticed it. `Survived` is the obvious case; `NoCoverage` is the
 * same failure one step earlier — no test even reached it — and counts, because the gate's promise
 * is detection rather than execution. `Timeout` means the mutant hung the suite, which *is* a test
 * noticing. `Ignored` is a justified arid waiver. Compile/runtime errors are Stryker's own problem.
 */
export function isSurviving(mutant: ReportedMutant): boolean {
  return (SURVIVING as readonly string[]).includes(mutant.status);
}

/**
 * A status this tooling has no rule for — neither surviving nor detected. Stryker's schema already
 * carries one (`Pending`: a mutant that was never tested), and folding an unknown status silently
 * into "detected" is the reading that loses drift with nothing watching: the weekly job runs
 * `continue-on-error` and its issues are its only output, so a miss there is simply invisible.
 * Surfaced instead of guessed.
 */
export function isUnclassified(mutant: ReportedMutant): boolean {
  return !isSurviving(mutant) && !(DETECTED as readonly string[]).includes(mutant.status);
}

/**
 * What a report actually audited, as counts. This lives in the model rather than in either
 * presenter because it is the basis of a *decision*, not a rendering: "no surviving mutants",
 * "the scope produced no mutants at all" and "every mutant here was ignored" are three different
 * outcomes, and the changed-line verdict fails on the last two while the summary merely words them
 * differently. Two derivations of that distinction would be two chances to disagree about whether a
 * scope was audited.
 */
export interface Counted {
  readonly files: number;
  readonly mutants: number;
  readonly ignored: number;
  readonly unclassified: readonly string[];
}

export function countMutants(report: MutationReport): Counted {
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

/** The two ways a scope can turn out not to have been audited at all. */
export type AuditGap = 'no-mutants' | 'all-ignored';

/**
 * Nothing in this scope was actually audited: either it produced no mutants at all, or every mutant
 * it produced was ignored as arid or unmeasurable. Neither is a clean bill — the verdict refuses on
 * both (design D4, condition 3) and the summary words them differently — so the classification is
 * returned as a value here rather than derived once per presenter. Two derivations would be two
 * chances to disagree about whether a scope was audited.
 */
export function auditGap(counted: Counted): AuditGap | undefined {
  if (counted.mutants === 0) return 'no-mutants';
  return counted.mutants === counted.ignored ? 'all-ignored' : undefined;
}

/** Code-unit order — the order this repo's boundary guards report paths in. */
export function byPath(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/**
 * Where Stryker writes the report. Kept beside the readers so `report.ts` and `file-drift.ts` share
 * one spelling; `mutation-scope.test.ts` pins it against `stryker.config.mjs`'s `jsonReporter`, so
 * changing the config alone fails loudly rather than leaving both entrypoints quietly reporting
 * "no report" under a green run.
 */
export const REPORT_PATH = 'reports/mutation/mutation.json';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMutant(value: unknown): value is ReportedMutant {
  if (!isRecord(value)) return false;
  if (typeof value.mutatorName !== 'string' || typeof value.status !== 'string') return false;
  const location = value.location;
  if (!isRecord(location)) return false;
  return isLine(location.start) && isLine(location.end) && hasColumn(location.end);
}

/**
 * Lines are 1-based integers in Stryker's schema. `typeof NaN === 'number'`, and a `NaN` line makes
 * every overlap comparison false — the mutant drops silently out of the failure scope, which is the
 * vacuously-green direction this door exists to close. So the door checks rather than assumes.
 */
function isLine(value: unknown): boolean {
  return isRecord(value) && Number.isSafeInteger(value.line) && (value.line as number) > 0;
}

function hasColumn(value: unknown): boolean {
  return isRecord(value) && Number.isSafeInteger(value.column) && (value.column as number) > 0;
}

function isReport(value: unknown): value is MutationReport {
  if (!isRecord(value) || !isRecord(value.files)) return false;
  return Object.values(value.files).every(
    (file) => isRecord(file) && Array.isArray(file.mutants) && file.mutants.every(isMutant),
  );
}

/**
 * The report as a value, for every way there is not one: absent, unparseable, or parseable but not
 * a mutation report. All three are `undefined` here. Callers separate ABSENT (they hold the raw
 * text, or do not) from unreadable, and say each out loud; the two unreadable shapes are reported
 * together, because from here they are the same fact and the wording says so. A crashed run must
 * never read as a clean one, and the step that says so must not itself crash.
 */
export function readReport(raw: string | undefined): MutationReport | undefined {
  if (raw === undefined) return undefined;
  const parsed = parseJson(raw);
  return isReport(parsed) ? parsed : undefined;
}

/** `JSON.parse` throws on malformed input; converted to a value at the one place it is called. */
function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

import { readFileSync } from 'node:fs';
import { readReport } from './report-model.ts';
import type { MutationReport, ReportedMutant } from './report-model.ts';

/**
 * The per-mutant waiver (change: mutation-recorded-survivors).
 *
 * Stryker offers two granularities and this repo needs a third. `// Stryker disable next-line
 * <mutator>` waives every mutant of that mutator on that line; the `ignorers` plugin API waives
 * every mutant generated from a node's subtree (`shouldIgnore(path)` cannot see which mutator or
 * replacement is being applied — verified against `IgnorerBookkeeper` in 9.6.1). But an *equivalent
 * mutant* is a property of a single mutant, and at every site this exists for the equivalent one
 * shares its line AND its mutator with a killable sibling:
 *
 *     if (x !== undefined && f(x))     // `true`  — the narrowing operand: equivalent
 *                                      // `false` — the whole guard gone: a real finding
 *
 * Both are `ConditionalExpression` on one line. The vendor's waiver would take the finding along
 * with the equivalence, so this one names the **replacement text** as well, and waives exactly the
 * mutant it argues about (design D2).
 *
 * The marker is a comment at the site, anchored to the line below it exactly as `disable next-line`
 * is. That is what keeps it honest: it travels with the code it argues about, so there is no line
 * number to maintain and no content hash to invalidate — the two ways a checked-in baseline file
 * rots into a list nobody rechecks.
 *
 *     // Stryker recorded-survivor ConditionalExpression `true`: <the proof no test can tell>
 *
 * This module is a pure function over (report, source text). The I/O shells — `file-drift.ts` and
 * `pr-verdict.ts` — read the files and act on the staleness; reading source belongs at their edge,
 * and keeping the decision pure is the same rule `verdict.ts` follows.
 */

/**
 * The reason attached to a reclassified mutant. Stryker writes an `ignoreReason`-derived
 * `statusReason` for its own waivers, so a recorded survivor reads the same way in any consumer
 * that surfaces one — and reads as *ours*, not as something the vendor decided.
 */
export const RECORDED_SURVIVOR_REASON =
  'Recorded survivor: proven equivalent at the site, waived per mutant because its line carries a ' +
  'killable sibling of the same mutator (mutation-recorded-survivors, D2).';

export interface RecordedSurvivor {
  /** The line the marker speaks for — the first line at or after it that is not another marker. */
  readonly line: number;
  readonly mutatorName: string;
  readonly replacement: string;
  readonly reason: string;
}

/** A marker naming a mutant the run did not produce as a survivor: the waiver outlived its argument. */
export interface StaleRecordedSurvivor extends RecordedSurvivor {
  readonly file: string;
}

/**
 * Anchored at the start of the comment so a marker cannot hide mid-sentence in prose — this file's
 * own header and the design doc both discuss the mechanism by name, and a parser keying on the
 * phrase alone would waive whatever line followed a paragraph about waiving.
 *
 * The replacement is backtick-delimited because replacements contain colons, parentheses and
 * quotes (`"\"\""`, `story === undefined && !isCorrelationId(story)`); a colon-delimited grammar
 * would need escaping the first time it met a real one. `[^`\n]+` keeps it to a single line, which
 * every waived replacement is — a multi-line replacement inside a comment would be unreadable, so
 * it is rejected rather than mangled.
 *
 * The reason is REQUIRED, and `\S` is what requires it: an unargued waiver is the defect the whole
 * doctrine is about, and a grammar that made the reason optional would make writing one optional.
 */
const MARKER =
  /^\s*\/\/\s*Stryker recorded-survivor\s+(?<mutator>[A-Za-z]+)\s+`(?<replacement>[^`\n]+)`:\s*(?<reason>\S.*)$/;

/** A line that is only a comment — the marker's own line, or a continuation of a reason. */
const COMMENT_ONLY = /^\s*(\/\/|\/\*|\*)/;

/** The prose of a continuation line, with its comment opener stripped. */
const CONTINUATION = /^\s*(?:\/\/|\*)\s?(.*)$/;

/** A line with no code on it: blank, or comment-only. Markers may stack, and reasons may wrap. */
function isCodeless(line: string): boolean {
  return line.trim() === '' || COMMENT_ONLY.test(line);
}

/**
 * Every marker in a source text, each carrying the 1-based line it speaks for.
 *
 * Several markers may stack above one line — a line can hold two equivalent mutants under different
 * mutators, and each needs its own argument — so the anchor skips past any run of comment and blank
 * lines to the first line carrying code, rather than stopping at the immediately-next line.
 */
export function parseRecordedSurvivors(source: string): RecordedSurvivor[] {
  const lines = source.split('\n');
  const found: RecordedSurvivor[] = [];
  for (const [index, line] of lines.entries()) {
    const match = MARKER.exec(line);
    if (match?.groups === undefined) continue;
    // The reason runs to the end of its comment block, not to the end of its first line. Every real
    // argument here spans several lines — the proof that no test can distinguish a mutant does not
    // fit on one, and a long replacement can push the whole argument onto the second line by
    // itself. Judging "is this argued?" on the first line alone would grade where the author
    // happened to wrap. The fold stops at the next marker, so two arguments never merge into one.
    const reason = [match.groups.reason!.trim()];
    let isFolding = true;
    let anchor = index + 1;
    while (anchor < lines.length && isCodeless(lines[anchor]!)) {
      const next = lines[anchor]!;
      // The anchor keeps walking past a stacked marker — its own block still stands between this
      // marker and the code — but this marker's reason stops there.
      if (MARKER.test(next)) isFolding = false;
      if (isFolding) {
        const continued = CONTINUATION.exec(next)?.[1]?.trim();
        if (continued !== undefined && continued !== '') reason.push(continued);
      }
      anchor += 1;
    }
    // A marker at the end of a file speaks for nothing. It anchors past the last line and simply
    // matches no mutant, which the staleness check then reports — the same answer as any other
    // marker whose argument has moved out from under it.
    found.push({
      line: anchor + 1,
      mutatorName: match.groups.mutator!,
      replacement: match.groups.replacement!,
      reason: reason.join(' '),
    });
  }
  return found;
}

/** How the caller hands over a mutated file's source; `undefined` when it cannot be read. */
export type ReadSource = (file: string) => string | undefined;

export interface AppliedRecordedSurvivors {
  readonly report: MutationReport;
  readonly stale: readonly StaleRecordedSurvivor[];
}

function isNamedBy(mutant: ReportedMutant, recorded: RecordedSurvivor): boolean {
  return (
    mutant.location.start.line === recorded.line &&
    mutant.mutatorName === recorded.mutatorName &&
    mutant.replacement === recorded.replacement
  );
}

/**
 * Statuses that say nothing about the waiver either way.
 *
 * `Timeout` is a *detected* status — the mutant hung the suite, which is a test noticing — so the
 * waiver does not apply on a run that reports one. But it is also the status a healthy mutant
 * returns when the machine is loaded, and a full run shares its host with whatever else is
 * building. Reading that as a stale waiver would redden the weekly job for a flake, and a red
 * weekly job nobody believes is the channel going quiet by another route. `CompileError` and
 * `RuntimeError` are Stryker's own problems for the same reason.
 *
 * A `Killed` mutant is NOT here: that is a test genuinely killing what the marker argued no test
 * could, which is exactly the waiver outliving its argument.
 */
const INCONCLUSIVE = ['Timeout', 'CompileError', 'RuntimeError'] as const;

function isInconclusive(mutant: ReportedMutant): boolean {
  return (INCONCLUSIVE as readonly string[]).includes(mutant.status);
}

const SURVIVING = ['Survived', 'NoCoverage'] as const;

/**
 * Which of a file's mutants its markers waive, and which markers found nothing to waive.
 *
 * A marker waives exactly ONE mutant (design D3): the match is consumed, so a second survivor with
 * the same mutator and replacement stays visible rather than being absorbed by an argument written
 * about the first.
 */
function waivedIn(
  mutants: readonly ReportedMutant[],
  source: string,
): {
  readonly mutants: ReadonlySet<ReportedMutant>;
  readonly unmatched: readonly RecordedSurvivor[];
} {
  const waived = new Set<ReportedMutant>();
  const unmatched: RecordedSurvivor[] = [];
  for (const recorded of parseRecordedSurvivors(source)) {
    const target = mutants.find(
      (mutant) =>
        !waived.has(mutant) &&
        (SURVIVING as readonly string[]).includes(mutant.status) &&
        isNamedBy(mutant, recorded),
    );
    if (target !== undefined) {
      waived.add(target);
    } else if (mutants.every((mutant) => !isNamedBy(mutant, recorded) || !isInconclusive(mutant))) {
      // Nothing to waive, and the run DID grade every mutant of this name: the waiver has outlived
      // its argument. An inconclusive grade means this run simply has no opinion (design D4a).
      unmatched.push(recorded);
    }
  }
  return { mutants: waived, unmatched };
}

/**
 * Rewrite every mutant a marker names from `Survived` to `Ignored`, and report the markers that
 * found nothing to waive.
 *
 * Reclassified rather than filtered out (design D5). `isSurviving` then excludes it, `countMutants`
 * counts it under `ignored`, and `auditGap` can still tell a file whose every mutant was waived
 * ("all-ignored", which the verdict refuses on) from a file that was genuinely clean. Dropping the
 * mutants instead would have converted the first case into the second — an unaudited scope wearing
 * the shape of a passing one, which is the single most dangerous outcome this tooling has.
 *
 * Only survivors are touched. A marker names a survivor by definition, and reclassifying a killed
 * mutant would be harmless today and a silent downgrade the day that kill regresses.
 *
 * Staleness is asserted only for files the report contains (design D4). A PR-scoped run mutates the
 * changed files and nothing else, so markers everywhere else have no mutant to match and would read
 * as stale — failing the gate over files it never looked at. The weekly full run sees every file,
 * so every marker is still rechecked, weekly, by the job whose whole purpose is that recheck.
 */
export function applyRecordedSurvivors(
  report: MutationReport,
  readSource: ReadSource,
): AppliedRecordedSurvivors {
  const files: Record<string, { readonly mutants: readonly ReportedMutant[] }> = {};
  const stale: StaleRecordedSurvivor[] = [];

  for (const [file, entry] of Object.entries(report.files)) {
    const { mutants } = entry;
    const source = readSource(file);
    // A report naming a file that is no longer on disk is the RUN being stale, not the waiver. There
    // is nothing to parse and nothing to blame, so the mutants pass through as they arrived.
    if (source === undefined) {
      files[file] = entry;
      continue;
    }
    const waived = waivedIn(mutants, source);
    stale.push(...waived.unmatched.map((recorded) => ({ ...recorded, file })));
    // The file entry is SPREAD, not rebuilt from its mutants. Stryker's report carries per-file
    // fields this tolerant model never declares (`source`, `language`), and `pr-verdict.ts` hands
    // the transformed report onward as text — rebuilding would silently drop them and publish a
    // lossy report under the vendor's name.
    files[file] = {
      ...entry,
      mutants: mutants.map((mutant) =>
        waived.mutants.has(mutant)
          ? { ...mutant, status: 'Ignored', statusReason: RECORDED_SURVIVOR_REASON }
          : mutant,
      ),
    };
  }

  return { report: { files }, stale };
}

/**
 * The same transform over the report's raw TEXT, for the shell that hands the report onward as text
 * rather than as a value (`pr-verdict.ts`, whose decider parses it itself).
 *
 * Text that is not a readable report passes through UNCHANGED. Every refusal the deciders make for
 * an absent or unparseable report is theirs to make, and swallowing one here — returning `undefined`
 * for a report that merely failed to parse — would turn `unreadable-report` into `no-report` and
 * lose the distinction the verdict is careful to draw.
 */
export function refineReportText(
  raw: string | undefined,
  readSource: ReadSource,
): { readonly raw: string | undefined; readonly stale: readonly StaleRecordedSurvivor[] } {
  const parsed = readReport(raw);
  if (parsed === undefined) return { raw, stale: [] };
  const { report, stale } = applyRecordedSurvivors(parsed, readSource);
  return { raw: JSON.stringify(report), stale };
}

/**
 * The disk reader both shells use. A file the report names but the tree no longer holds reads as
 * `undefined` — the run being stale, not the waiver — and the mutants pass through untouched. The
 * catch is held tight against the vendor call and converts only it, per `error-handling.md`.
 */
export const readSourceFromDisk: ReadSource = (file) => {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return;
  }
};

/** One line per stale marker, for a shell that is about to exit non-zero because of it. */
export function describeStale(stale: readonly StaleRecordedSurvivor[]): string {
  return stale
    .map(
      (entry) =>
        `${entry.file}:${entry.line} — recorded survivor \`${entry.mutatorName} \`${entry.replacement}\`\` matched no surviving mutant. ` +
        'The waiver has outlived its argument: re-argue it, or delete it.',
    )
    .join('\n');
}

/**
 * Which lines a branch added or modified, read out of a unified diff
 * (change: mutation-gate-diff-scope).
 *
 * This is the gate's *failure* scope. The mutation run still mutates whole changed FILES and the
 * step summary still reports all of it — "suppress the gate, never the feedback" — but a branch is
 * only failed for a surviving mutant whose span touches a line that branch actually wrote (design
 * D1). Everything that decision rests on is in this file plus `verdict.ts`.
 *
 * The diff arrives as text. The job runs git once, into a file, and this module parses it: a pure
 * text → ranges function with tests, rather than a shell-out buried inside a script that nothing can
 * exercise. Getting a hunk header wrong here does not crash anything — it moves the gate, quietly,
 * which is why the tests are generated from real `git diff` output rather than written by hand.
 */

/** An inclusive run of lines on the diff's NEW side — the lines that exist after the change. */
export interface LineRange {
  readonly start: number;
  readonly end: number;
}

/**
 * Changed lines per file, keyed exactly as the diff spelled the path.
 *
 * A file the diff NAMES is always a key, even when it contributes no range — a branch that only
 * deleted lines from a file changed that file without writing a line in it. The two facts are
 * different and the verdict needs both: the key set is what joins against the mutation report (a
 * scope that joins nothing was never audited), and the ranges are what a mutant's span has to
 * overlap to become a finding. Collapsing them would make "this branch only deleted code" look
 * exactly like "the two path spellings no longer match" — a pass and a refusal.
 */
export type ChangedLines = ReadonlyMap<string, readonly LineRange[]>;

/**
 * The flags the CI job must pass, declared here so the workflow, this parser, and its tests cannot
 * drift onto different git output. `mutation-scope.test.ts` asserts the workflow's `git diff` line
 * carries every one of them.
 *
 * `--no-prefix` is the load-bearing one. By default git prints `+++ b/packages/…`, and this key is
 * joined against Stryker's report keys, which are `path.relative(cwd, file)`. A surviving `b/` would
 * make every intersection false and the gate vacuously, permanently green — success-shaped failure,
 * the worst outcome available (design D4). With `--no-prefix` the two sides are the same string;
 * should they ever stop being, `verdict.ts` refuses the run as unaudited rather than passing it.
 *
 * `-U0` asks for no context lines, so every line inside a hunk is a changed line and the header's
 * arithmetic is the whole answer. `--diff-filter=ACMR` matches the scope step: a deleted file has
 * nothing left to mutate.
 */
export const DIFF_FLAGS: readonly string[] = ['-U0', '--no-prefix', '--diff-filter=ACMR'];

/**
 * `@@ -<old start>[,<old count>] +<new start>[,<new count>] @@ [heading]`.
 *
 * Anchored at the start of the line, because a diff carries the *content* of source files and a
 * string literal beginning `@@` inside one would otherwise move the gate.
 */
const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

/** Any hunk header, contributing a range or not — what closes a section's header region. */
const HUNK_PREFIX = '@@ -';

/** `+++ <path>` under `--no-prefix`; `/dev/null` when the change deleted the file. */
const NEW_SIDE = /^\+\+\+ (.+)$/;

/**
 * Opens a file's section, and with it the region in which `+++` means a filename. Under
 * `--no-prefix` the two paths are the source and destination spellings, so the second is the file as
 * it exists after the change — the one Stryker will key its report by.
 *
 * The destination is registered from THIS line rather than only from `+++`, because git emits no
 * `---`/`+++` pair at all for a pure rename or a mode-only change. Such a file is in the mutate
 * scope (`--diff-filter=ACMR` keeps it) and therefore in the report, so a parser that never named it
 * would leave a file in the report joining nothing — which the verdict is right to refuse, over a
 * branch that did nothing wrong.
 */
const FILE_SECTION = /^diff --git (?:\S+) (\S+)$/;

const DELETED = '/dev/null';

/**
 * The lines one hunk header contributes, or `undefined` for a header that contributes none.
 *
 * Two rules, both of which produce a wrong gate rather than an error if they are got wrong, and both
 * verified against real `-U0` output from this repo:
 *
 * - **The new-side count may be absent**, and absent means exactly one line (`@@ -85 +85 @@`).
 *   Defaulting it to zero would drop every single-line edit out of the failure scope.
 * - **A new-side count of zero is a pure deletion** (`@@ -12,3 +11,0 @@`): lines left and none
 *   arrived. Reading it as the range `11-11` would gate the branch on the surviving line *next to*
 *   what it removed — a line it never touched. Deletions are already dropped from the mutate scope
 *   by `--diff-filter=ACMR`; this is the same rule one level down, at the hunk.
 */
export function parseHunkHeader(line: string): LineRange | undefined {
  const matched = HUNK_HEADER.exec(line);
  if (matched === null) return undefined;

  const start = Number(matched[1]);
  const count = matched[2] === undefined ? 1 : Number(matched[2]);
  return count === 0 ? undefined : { start, end: start + count - 1 };
}

/**
 * Every file a unified diff names, with the lines it added or modified in each.
 *
 * Files are keyed off the `+++` side rather than `---`, because a file the branch ADDED has
 * `/dev/null` on the old side and would otherwise lose every one of its lines. A file whose only
 * hunks are pure deletions is still a key, with no ranges: see {@link ChangedLines}.
 */
export function parseChangedLines(diff: string): ChangedLines {
  const changed = new Map<string, LineRange[]>();
  let file: string | undefined;
  // `+++ x` names a file only in a section's HEADER region. Under `-U0` every line inside a hunk is
  // an added or removed one, so an added line whose content begins `++ ` is printed as `+++ ` and is
  // indistinguishable from a header by shape alone. Reading one as a header would re-key every hunk
  // after it onto a file that does not exist — no findings, and the run reads clean. The region opens
  // at `diff --git` (and at the start of the text, so an abbreviated fixture still parses) and closes
  // at the section's first hunk.
  let isInHeader = true;

  for (const line of diff.split('\n')) {
    const section = FILE_SECTION.exec(line);
    if (section !== null) {
      isInHeader = true;
      file = section[1];
      if (file !== undefined) changed.set(file, changed.get(file) ?? []);
      continue;
    }

    const newSide = isInHeader ? NEW_SIDE.exec(line) : null;
    if (newSide !== null) {
      const named = newSide[1]?.trim();
      file = named === DELETED ? undefined : named;
      if (file !== undefined) changed.set(file, changed.get(file) ?? []);
      continue;
    }

    if (!line.startsWith(HUNK_PREFIX)) continue;
    // Closed by ANY hunk header, including a pure deletion that contributes no range. Closing only
    // on a contributing hunk would leave the region open across a deletion-only hunk, so the
    // spoof guard would rest on the second fact that such a hunk emits no `+` lines.
    isInHeader = false;
    const hunk = parseHunkHeader(line);
    if (hunk === undefined || file === undefined) continue;
    changed.set(file, [...(changed.get(file) ?? []), hunk]);
  }

  return changed;
}

/**
 * Does a mutated span touch any changed line — **overlap**, not containment.
 *
 * This is the single reason the gate post-filters a file-scoped run instead of range-scoping the run
 * itself (design D2). Stryker's own range filter is containment (`locationIncluded`), so a mutant
 * whose node is *larger* than the range is never generated at all: a `BlockStatement` removal
 * spanning a whole function is dropped when only one line inside it changed. Statement-block removal
 * is 72.18% of Google's mutants and the mutation type second-least likely to survive, so dropping it
 * silently would be a large hole in exactly the direction that reads as success.
 *
 * A file the branch did not change has no ranges and nothing in it can overlap — passed as
 * `undefined` rather than as an empty list so the caller has one shape to hand over.
 */
export function isOnChangedLine(
  ranges: readonly LineRange[] | undefined,
  span: LineRange,
): boolean {
  return (ranges ?? []).some((range) => span.start <= range.end && range.start <= span.end);
}

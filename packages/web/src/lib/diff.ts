/**
 * Word-level string diff for the match review's tag comparison (design D7): near-identical
 * strings are the common case in music metadata, and an unhighlighted value pair under-serves
 * them (Picard's documented weakness — research §5). Pure and server-computed; the components
 * render the segments, so no client scripting is involved.
 */

export interface DiffSegment {
  readonly text: string;
  readonly changed: boolean;
}

/** Whitespace-preserving word tokens; unicode-safe because no character is ever split or lost. */
function tokens(value: string): string[] {
  return value.split(/(\s+)/u).filter((part) => part !== '');
}

/** Longest-common-subsequence table over the two token arrays (values are short strings). */
function lcsTable(from: readonly string[], to: readonly string[]): number[][] {
  const table: number[][] = Array.from({ length: from.length + 1 }, () =>
    Array.from({ length: to.length + 1 }, () => 0),
  );
  for (let row = from.length - 1; row >= 0; row -= 1) {
    for (let column = to.length - 1; column >= 0; column -= 1) {
      table[row]![column] =
        from[row] === to[column]
          ? table[row + 1]![column + 1]! + 1
          : Math.max(table[row + 1]![column]!, table[row]![column + 1]!);
    }
  }
  return table;
}

function mergeSegments(parts: readonly DiffSegment[]): DiffSegment[] {
  const merged: DiffSegment[] = [];
  for (const part of parts) {
    const last = merged.at(-1);
    if (last !== undefined && last.changed === part.changed) {
      merged[merged.length - 1] = { text: last.text + part.text, changed: last.changed };
    } else {
      merged.push(part);
    }
  }
  return merged;
}

export interface WordDiff {
  readonly from: readonly DiffSegment[];
  readonly to: readonly DiffSegment[];
}

/**
 * Both sides of a current-vs-proposed pair, segmented so shared runs render plain and each
 * side's own divergent words carry the highlight. Identical inputs yield single unchanged
 * segments; either side may be empty.
 */
export function wordDiff(fromValue: string, toValue: string): WordDiff {
  const fromTokens = tokens(fromValue);
  const toTokens = tokens(toValue);
  const table = lcsTable(fromTokens, toTokens);

  const fromParts: DiffSegment[] = [];
  const toParts: DiffSegment[] = [];
  let row = 0;
  let column = 0;
  while (row < fromTokens.length && column < toTokens.length) {
    if (fromTokens[row] === toTokens[column]) {
      fromParts.push({ text: fromTokens[row]!, changed: false });
      toParts.push({ text: toTokens[column]!, changed: false });
      row += 1;
      column += 1;
    } else if (table[row + 1]![column]! >= table[row]![column + 1]!) {
      fromParts.push({ text: fromTokens[row]!, changed: true });
      row += 1;
    } else {
      toParts.push({ text: toTokens[column]!, changed: true });
      column += 1;
    }
  }
  for (; row < fromTokens.length; row += 1) {
    fromParts.push({ text: fromTokens[row]!, changed: true });
  }
  for (; column < toTokens.length; column += 1) {
    toParts.push({ text: toTokens[column]!, changed: true });
  }

  return { from: mergeSegments(fromParts), to: mergeSegments(toParts) };
}

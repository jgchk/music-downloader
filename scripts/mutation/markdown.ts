/**
 * The bits of Markdown all three mutation presenters need (change: mutation-gate-diff-scope).
 *
 * `summarize.ts`, `drift.ts` and `verdict-summary.ts` each render a table into a GitHub surface.
 * `cell` used to live in `summarize.ts` and be imported by the others, which made a presenter double
 * as the shared utility module; `plural` was simply copied. Both now have one home, so a fix to the
 * escaping rule reaches every table rather than whichever one the author was looking at.
 */

/** Markdown table cells cannot carry a pipe or a newline. */
export function cell(text: string): string {
  return text.replaceAll('|', String.raw`\|`).replaceAll('\n', ' ');
}

/** `1 mutant` / `2 mutants` — the counts in these summaries are read as prose, not as data. */
export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

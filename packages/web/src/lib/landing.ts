/**
 * Presentation vocabulary for the landing dashboard: each stat is parsed at the load boundary into
 * a discriminated view, so a degraded read is a distinct variant carrying its apology — never a
 * false zero sitting beside an error flag. Mirrors `parseAcquisitionView` in `acquisitions.ts`.
 */

/**
 * One dashboard stat, parsed at the edge. A healthy read is an `ok` count; a faulted read is
 * `unavailable` with the apology to show. The `unavailable` variant has no `count`, so the
 * false-zero-alongside-error state is unconstructable.
 */
export type SectionView =
  | { readonly kind: 'ok'; readonly count: number }
  | { readonly kind: 'unavailable'; readonly message: string };

/** Parse a guarded read into its section view: the count when healthy, the apology when faulted. */
export function parseSection(
  read: { readonly entries: readonly unknown[]; readonly failed: boolean },
  message: string,
): SectionView {
  return read.failed
    ? { kind: 'unavailable', message }
    : { kind: 'ok', count: read.entries.length };
}

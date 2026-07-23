/**
 * A readonly array proven to hold at least one element: `readonly [T, ...T[]]`. A {@link Target}'s
 * track list is non-empty by construction — its smart constructor rejects `NoTracks` — so lifting
 * that `.length` invariant into the type turns a fact scattered across matching/validation call
 * sites into one the compiler carries: `reduce` without a seed is total, and no consumer has to
 * handle an impossible empty case. Runtime-identical to a plain array, so a target that rides on an
 * event serializes byte-for-byte unchanged.
 */
export type NonEmptyReadonlyArray<T> = readonly [T, ...T[]];

/**
 * Narrow a readonly array to a {@link NonEmptyReadonlyArray} — the checked construction at a branch
 * point where the empty case has its own honest handling.
 */
export function isNonEmpty<T>(array: readonly T[]): array is NonEmptyReadonlyArray<T> {
  return array.length > 0;
}

/**
 * Assert a readonly array is non-empty. Trusted: call it only where an earlier guard has already
 * proven `length > 0` (e.g. a smart constructor past its `NoTracks` check) — the structural analogue
 * of a brand's mint, doing no runtime work so it cannot mask a real empty.
 */
export function assertNonEmpty<T>(array: readonly T[]): NonEmptyReadonlyArray<T> {
  return array as NonEmptyReadonlyArray<T>;
}

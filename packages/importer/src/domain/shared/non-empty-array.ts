/**
 * A readonly array proven to hold at least one element: `readonly [T, ...T[]]`. Several domain
 * collections are non-empty by construction — a duplicate review always names ≥ 1 incumbent, a
 * remediation always carries ≥ 1 failure, a manual tag payload always maps ≥ 1 track, a proposal
 * `bestOf` is only asked for a non-empty field. Lifting those into this type turns a `.length`
 * invariant scattered across call sites into a fact the compiler carries: `reduce` without a seed is
 * total, and a consumer never has to handle an impossible empty case. Runtime-identical to a plain
 * array, so any such collection that rides on an event serializes byte-for-byte unchanged.
 */
export type NonEmptyReadonlyArray<T> = readonly [T, ...T[]];

/**
 * Narrow a readonly array to a {@link NonEmptyReadonlyArray} — the checked construction at a branch
 * point where the empty case has its own honest handling (a no-match proposal, a doomed duplicate).
 */
export function isNonEmpty<T>(arr: readonly T[]): arr is NonEmptyReadonlyArray<T> {
  return arr.length > 0;
}

/**
 * Assert a readonly array is non-empty. Trusted: call it only where a schema or an earlier guard has
 * already proven `length > 0` (e.g. a wire array validated `.min(1)`) — the structural analogue of a
 * brand's smart-constructor mint, doing no runtime work so it cannot mask a real empty.
 */
export function assertNonEmpty<T>(arr: readonly T[]): NonEmptyReadonlyArray<T> {
  return arr as NonEmptyReadonlyArray<T>;
}

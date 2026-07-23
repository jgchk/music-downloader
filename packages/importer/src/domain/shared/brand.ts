/**
 * A phantom brand — a compile-time-only tag that makes a validated value distinct from its raw
 * structural shape, so the value can only originate from its smart constructor
 * (validate-don't-parse). The tag is a type-level fiction: it is erased at runtime, so a branded
 * value *is* its underlying value and JSON round-tripping of events that carry branded values is
 * byte-identical to the unbranded shape.
 */
export type Brand<T, B extends string> = T & { readonly __brand: B };

/**
 * Mint a branded value from its already-validated base (the branded shape minus the phantom tag).
 * This is the single sanctioned cast: call it only from a smart constructor, right where the
 * invariant has just been proven. Runtime identity — the brand is erased, so the value is untouched.
 */
export function branded<B extends Brand<unknown, string>>(base: Omit<B, '__brand'>): B {
  return base as unknown as B;
}

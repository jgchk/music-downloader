/** Ambient capabilities injected into the shell so it stays deterministic under test. */

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  next(): string;
}

/**
 * Mints the ids of the operation-correlation pair (32 lowercase hex, W3C-trace-id-compatible).
 * Deliberately separate from {@link IdGenerator}: that one mints aggregate identities in the
 * store's uuid format, and the two formats must not drift into each other. Injected so every mint
 * point stays deterministic under test.
 */
export interface CorrelationSource {
  mint(): string;
}

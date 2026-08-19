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
 *
 * It mints the BRANDED id, so the composition root's implementation is the single place the format
 * is established — every lift downstream then follows from a constructor rather than from trust.
 */
export type { CorrelationSource } from '@music/eventing';

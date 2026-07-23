import type { CommandError } from './command-handler.js';

/**
 * Effect-failure classification (reactor-durability D2), exhaustive over every `CommandError`
 * kind so a future error variant is a compile-time decision here, not a silent fallthrough:
 * - `retryable` — a transient infrastructure fault or a concurrency conflict: park with backoff.
 * - `permanent` — a fault the adapter recognized as unfixable-by-retry: short-circuit the budget
 *   and land immediately.
 * - `rejection` — the domain refused the follow-on as stale/illegal (the stream already settled
 *   it): record and advance past; retrying would re-fire the same rejection forever.
 */
export type FailureClass = 'retryable' | 'permanent' | 'rejection';

export function classifyCommandError(error: CommandError): FailureClass {
  switch (error.kind) {
    case 'InfraError': {
      return error.permanent === true ? 'permanent' : 'retryable';
    }
    case 'ConcurrencyConflict': {
      return 'retryable';
    }
    case 'AlreadyExists':
    case 'IllegalTransition':
    case 'UnknownEdition': {
      return 'rejection';
    }
  }
}

/** A one-line rendering for park entries and dead-letter context. */
export function describeCommandError(error: CommandError): string {
  return error.kind === 'InfraError'
    ? `${error.operation}: ${error.message}`
    : JSON.stringify(error);
}

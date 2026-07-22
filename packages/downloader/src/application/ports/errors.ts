/**
 * Infrastructure faults (D3): the neverthrow `Err` channel of the outbound ports. Distinct from
 * business sadness (a stalled download, no candidates), which flows as domain events. The shell
 * treats an `InfraError` as retryable (backoff / dead-letter) unless the adapter marked it
 * permanent — never as a fact.
 */
export interface InfraError {
  readonly kind: 'InfraError';
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
  /**
   * A permanent condition the adapter recognized (schema drift, a 4xx-shaped refusal): retrying
   * can never fix it, so the reactor short-circuits the retry budget and lands it immediately
   * (reactor-durability D2). Absent means transient — retry with backoff.
   */
  readonly permanent?: boolean;
}

export function infraError(operation: string, message: string, cause?: unknown): InfraError {
  return { kind: 'InfraError', operation, message, cause };
}

/** An {@link InfraError} the adapter classified as permanent — never worth retrying. */
export function permanentInfraError(
  operation: string,
  message: string,
  cause?: unknown,
): InfraError {
  return { kind: 'InfraError', operation, message, cause, permanent: true };
}

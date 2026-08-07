import { toCorrelationId } from '../correlation/context.js';
import type { CommandContext, OperationScope } from '../correlation/context.js';
import { silentLogger } from './fakes.js';
import type { AppendMetadata, EventMetadata } from '../ports/event-store-port.js';
import type { Clock, CorrelationSource } from '../ports/system-ports.js';

/** A well-formed story id for tests — 32 lowercase hex, the production format. */
export const STORY = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
/** A second, distinguishable story id — for "this one, not that one" assertions. */
export const OTHER_STORY = '00112233445566778899aabbccddeeff';

/**
 * A deterministic {@link CorrelationSource}: hands out `values` in order, then repeats the last one
 * forever, so a test can name exactly the ids a mint point should produce.
 */
export function fixedCorrelation(...values: readonly string[]): CorrelationSource {
  const minted = values.length > 0 ? values : [STORY, 'command-1'];
  let index = 0;
  return {
    mint: () => minted[Math.min(index++, minted.length - 1)]!,
  };
}

/** The context a request-minted command carries: a known story, parented on its own command. */
export function testContext(
  correlationId: string = STORY,
  commandId = 'command-1',
): CommandContext {
  return {
    correlationId: toCorrelationId(correlationId),
    causation: { kind: 'command', commandId },
  };
}

/**
 * Write-side metadata for a test's own setup appends. `clock` may be a {@link Clock} or a literal
 * timestamp, so a test that asserts on the rendered `occurredAt` can keep naming it.
 */
export function appendMetadata(
  acquisitionId: string,
  clock: Clock | string,
  context: CommandContext = testContext(),
): AppendMetadata {
  return {
    acquisitionId,
    occurredAt: typeof clock === 'string' ? clock : clock.now().toISOString(),
    correlationId: context.correlationId,
    causation: context.causation,
  };
}

/**
 * Metadata as a build BEFORE end-to-end-correlation would have written it — no correlation, no
 * causation. Real production rows look like this and always will, so every degradation path is
 * tested against this shape rather than against a hand-nulled field.
 */
export function legacyMetadata(acquisitionId: string, clock: Clock): EventMetadata {
  return { acquisitionId, occurredAt: clock.now().toISOString() };
}

/** The scope an adapter test hands an effect when the log lines are not what it is asserting. */
export function testScope(context: CommandContext = testContext()): OperationScope {
  return { context, logger: silentLogger() };
}

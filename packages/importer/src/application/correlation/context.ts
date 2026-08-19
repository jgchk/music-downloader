import { createCorrelation, operationScope as scopeOver } from '@music/eventing';
import type {
  CommandContext,
  ContinuedOperation,
  CorrelationSource,
  TriggeringEvent,
} from '@music/eventing';
import type { Logger } from '../logging/logger.js';

/**
 * This module's binding of the shared operation-correlation mechanism (`@music/eventing`). The
 * identity pair, its format, the adopt-vs-mint policy, and the causation parser are mechanism and
 * live there; what is declared here is the ONE consumer-specific fact — which store a derived
 * causation addresses — plus the logger type this module's scopes carry.
 *
 * See `@music/eventing`'s correlation module for the terminology that must not be got wrong
 * (correlation is the STORY, causation is the IMMEDIATE PARENT; Axon's docs invert both names).
 */

/** This module's namespace in a causation reference. */
export const CONTEXT_NAME = 'importer';

const correlation = createCorrelation(CONTEXT_NAME);

/**
 * Continue the story of an event stored in THIS module's store: the reactor hop. Namespaced with
 * {@link CONTEXT_NAME}; an event that arrived over the seam has its own path (`contextForDelivery`
 * at the inbound ACL) and must not be passed here.
 */
export function continueFrom(
  stored: TriggeringEvent,
  source: CorrelationSource,
): ContinuedOperation {
  return correlation.continueFrom(stored, source);
}

/**
 * A unit of work as the shell hands it to whatever performs it, carrying this module's own logger
 * type: the identity, and a logger already bound to it.
 */
export interface OperationScope {
  readonly context: CommandContext;
  readonly logger: Logger;
}

/** Bind the story onto a child of `parent`, paired with the context it was bound from. */
export function operationScope(
  context: CommandContext,
  parent: Logger,
  bindings: Record<string, unknown> = {},
): OperationScope {
  return scopeOver(context, parent, bindings);
}

export {
  CORRELATION_ID_PATTERN,
  adoptOrMint,
  adoptStory,
  causedBy,
  isCorrelationId,
  newOperation,
  parseCausation,
  toCorrelationId,
} from '@music/eventing';
export type {
  CausationReference,
  CommandContext,
  ContinuedOperation,
  CorrelationId,
  StoryOrigin,
  TriggeringEvent,
} from '@music/eventing';

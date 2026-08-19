import { err, ok } from 'neverthrow';
import { isCycleStart } from '../../../domain/import/events.js';
import type { Result } from 'neverthrow';
import type { StoredEvent } from '../../../application/ports/event-store-port.js';
import type {
  PublishedEvent,
  PublishedEventMapping,
  RenderError,
} from '../../../application/ports/published-events-port.js';
import { CONTEXT_NAME } from '../../../application/correlation/context.js';
import {
  RELEASE_VERDICT_TYPE,
  publishedCorrelationSchema,
  releaseVerdictEventSchema,
} from './schemas.js';

/**
 * The correlation envelope for a published event.
 *
 * The story is taken from the CYCLE the event belongs to — the most recent `ImportRequested` at or
 * before it — not from the event's own metadata. A verdict is a fact about the import cycle, and
 * that cycle's story is the one that crossed the seam inbound (`importer-outbound-events`: "the
 * correlation id SHALL be the one that crossed the seam"). The event's own metadata carries the
 * story of whatever triggered the last hop — for a verdict, the human request that resolved the
 * review, which is a different story and would break the round trip.
 *
 * What opens a cycle is the aggregate's fact, not this renderer's: `isCycleStart` answers it, so a
 * second cycle-opening event becomes a compile error there rather than a renderer that silently
 * publishes the previous cycle's story.
 *
 * Walking back to the cycle start (rather than to the head of the stream) is what keeps the
 * revival loop honest: a replacement delivery opens a NEW cycle with its own adopted story, and
 * its verdict must be published under that one, not the original delivery's.
 *
 * Never fabricated: a cycle whose rows predate the capability publishes no block at all, and the
 * consumer mints its own rather than inheriting an invented story.
 *
 * The block it returns is PROPOSED, not vouched for. Its one validator is
 * `publishedCorrelationSchema` at the call site, which drops the block whole when the story is
 * absent or malformed. This function used to pre-check with `isCorrelationId` as well, and that
 * guard could reject nothing the schema would accept — `isCorrelationId` is
 * `CORRELATION_ID_PATTERN.test(value)` and the schema's `correlationId` is
 * `z.string().regex(CORRELATION_ID_PATTERN)`, the same regex from the same module. It decided
 * nothing, and split "is this block publishable?" across two places that had to agree.
 */
function correlationOf(
  stored: StoredEvent,
  prefix: readonly StoredEvent[],
): Record<string, unknown> {
  const cycleStart = prefix.findLast(
    // Stryker recorded-survivor EqualityOperator `entry.version < stored.version`: equivalent — the
    // only entry AT `stored.version` is `stored` itself, and `renderVerdict` has already refused
    // anything that is not a `ReleaseVerdictRecorded`, which `isCycleStart` never accepts. The
    // boundary case the two operators disagree about cannot arise. The `>` mutant on this line IS a
    // real finding — it walks forward into a later cycle — which is why the line takes no waiver.
    (entry) => entry.version <= stored.version && isCycleStart(entry.event),
  );
  return {
    correlationId: cycleStart?.metadata.correlationId,
    // This event's OWN coordinates — the causal parent of whatever the consumer does on receipt.
    causation: {
      kind: 'event',
      context: CONTEXT_NAME,
      streamId: stored.streamId,
      version: stored.version,
    },
  };
}

/**
 * Renders `release.verdict` from a stored `ReleaseVerdictRecorded` (change:
 * outbound-release-verdicts). The domain event is minted self-contained — acquisition id,
 * candidate identity, reasons — so the PAYLOAD needs no prefix fold; the prefix is folded only to
 * find the cycle's originating story for the correlation envelope (see {@link correlationOf}). The
 * result is validated against the outbound schema; a violating payload never leaves the process.
 */

function renderError(message: string): RenderError {
  return { kind: 'RenderError', eventType: RELEASE_VERDICT_TYPE, message };
}

function renderVerdict(
  stored: StoredEvent,
  prefix: readonly StoredEvent[],
): Result<PublishedEvent, RenderError> {
  if (stored.event.type !== 'ReleaseVerdictRecorded') {
    return err(renderError(`event type ${stored.event.type} has no published mapping`));
  }
  const { acquisitionId, candidate, reasons } = stored.event;
  const envelope = {
    type: RELEASE_VERDICT_TYPE,
    timestamp: stored.metadata.occurredAt,
    data: {
      acquisitionId,
      candidate: {
        username: candidate.username,
        path: candidate.path,
        // Omitted — never null — when unknown: our serialization convention keeps absent fields absent.
        ...(candidate.sizeBytes !== undefined && { sizeBytes: candidate.sizeBytes }),
      },
      verdict: 'rejected',
      reasons: [...reasons],
    },
  };
  const parsed = releaseVerdictEventSchema.safeParse(envelope);
  if (!parsed.success) {
    return err(
      renderError(`rendered payload violates the outbound schema: ${parsed.error.message}`),
    );
  }
  // The correlation envelope is attached AFTER validation, deliberately. A `RenderError` is
  // permanent by contract: the outbound feed surfaces it, the consumer's checkpoint holds, and it
  // fails identically on every retry — so a defect in a purely DIAGNOSTIC field would
  // head-of-line-block the whole cross-context seam, forever. Telemetry may degrade the trace; it
  // may never stop the work. So the block is validated here and DROPPED on failure, never returned
  // as an error — and this parse is the block's ONLY validator, which is what keeps
  // `publishedCorrelationSchema` load-bearing: a rename in `correlationOf` would otherwise compile,
  // pass every gate, and silently detach every cross-context trace.
  const checked = publishedCorrelationSchema.safeParse(correlationOf(stored, prefix));
  const metadata = checked.success ? checked.data : undefined;
  // Stryker recorded-survivor ConditionalExpression `false`: equivalent — forced to the else arm,
  // the spread adds `metadata: undefined`, and `JSON.stringify` drops an undefined property, so the
  // published bytes are identical. Asserting the key's absence would pin a distinction no consumer
  // can observe (`OutboundFeed` re-adds the key one layer out) — a test written for the score.
  return ok(metadata === undefined ? parsed.data : { ...parsed.data, metadata });
}

/** The catalog of published event types — additive: future types join here. */
export const publishedEventMapping: PublishedEventMapping = {
  publishes: (type) => type === 'ReleaseVerdictRecorded',
  render: renderVerdict,
};

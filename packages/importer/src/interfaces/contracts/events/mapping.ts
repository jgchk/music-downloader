import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import type { StoredEvent } from '../../../application/ports/event-store-port.js';
import type {
  PublishedEvent,
  PublishedEventMapping,
  RenderError,
} from '../../../application/ports/published-events-port.js';
import { CONTEXT_NAME, isCorrelationId } from '../../../application/correlation/context.js';
import { RELEASE_VERDICT_TYPE, releaseVerdictEventSchema } from './schemas.js';

/**
 * The correlation envelope for a published event, or `undefined` when the story is unavailable.
 *
 * The story is taken from the CYCLE the event belongs to — the most recent `ImportRequested` at or
 * before it — not from the event's own metadata. A verdict is a fact about the import cycle, and
 * that cycle's story is the one that crossed the seam inbound (`importer-outbound-events`: "the
 * correlation id SHALL be the one that crossed the seam"). The event's own metadata carries the
 * story of whatever triggered the last hop — for a verdict, the human request that resolved the
 * review, which is a different story and would break the round trip.
 *
 * Walking back to the cycle start (rather than to the head of the stream) is what keeps the
 * revival loop honest: a replacement delivery opens a NEW cycle with its own adopted story, and
 * its verdict must be published under that one, not the original delivery's.
 *
 * Never fabricated: a cycle whose rows predate the capability yields no block at all, and the
 * consumer mints its own rather than inheriting an invented story.
 */
function correlationOf(
  stored: StoredEvent,
  prefix: readonly StoredEvent[],
): Record<string, unknown> | undefined {
  const cycleStart = prefix.findLast(
    (entry) => entry.version <= stored.version && entry.event.type === 'ImportRequested',
  );
  const story = cycleStart?.metadata.correlationId;
  if (story === undefined || !isCorrelationId(story)) return undefined;
  return {
    correlationId: story,
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
  // may never stop the work. `correlationOf` yields only a well-formed block or nothing at all.
  const metadata = correlationOf(stored, prefix);
  return ok(metadata === undefined ? parsed.data : { ...parsed.data, metadata });
}

/** The catalog of published event types — additive: future types join here. */
export const publishedEventMapping: PublishedEventMapping = {
  publishes: (type) => type === 'ReleaseVerdictRecorded',
  render: renderVerdict,
};

import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import type { StoredEvent } from '../../../application/ports/event-store-port.js';
import type {
  PublishedEvent,
  PublishedEventMapping,
  RenderError,
} from '../../../application/ports/published-events-port.js';
import { CONTEXT_NAME } from '../../../application/correlation/context.js';
import {
  ACQUISITION_FULFILLED_TYPE,
  acquisitionFulfilledEventSchema,
  publishedCorrelationSchema,
} from './schemas.js';

/**
 * The candidate correlation envelope for a stored event — proposed, not vouched for. Its one
 * validator is `publishedCorrelationSchema` at the call site, which drops the block whole when the
 * story is absent or malformed.
 *
 * It does NOT pre-check the story itself. It used to, with `isCorrelationId`, and that guard was
 * unreachable in the sense that matters: `isCorrelationId` is `CORRELATION_ID_PATTERN.test(value)`
 * and the schema's `correlationId` is `z.string().regex(CORRELATION_ID_PATTERN)` — the same regex,
 * from the same module. It could not reject a story the schema would have accepted, so it decided
 * nothing and only split the answer to "is this block publishable?" across two places that had to
 * agree. One validator is the whole point.
 *
 * Never fabricated, and that is unchanged: an absent story yields `correlationId: undefined`, the
 * schema rejects the block, and the consumer mints its own rather than inheriting an invented one.
 */
function correlationOf(stored: StoredEvent): Record<string, unknown> {
  return {
    correlationId: stored.metadata.correlationId,
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
 * Renders `acquisition.fulfilled` from the stream prefix (change: acquisition-outbound-events).
 * `DownloadFulfilled` alone does not carry the target/candidate detail, so the payload is
 * assembled from the facts already on the stream — the last `TargetResolved` and `Imported` before
 * the fulfilment — making rendering a deterministic, replay-safe function of the prefix. The result
 * is validated against the outbound schema; a violating payload never leaves the process.
 */

function renderError(message: string): RenderError {
  return { kind: 'RenderError', eventType: ACQUISITION_FULFILLED_TYPE, message };
}

function renderFulfilled(
  stored: StoredEvent,
  prefix: readonly StoredEvent[],
): Result<PublishedEvent, RenderError> {
  if (stored.event.type !== 'DownloadFulfilled') {
    return err(renderError(`event type ${stored.event.type} has no published mapping`));
  }
  const events = prefix.map((entry) => entry.event);
  const resolved = events.findLast((event) => event.type === 'TargetResolved');
  if (resolved === undefined) {
    return err(renderError('stream prefix carries no TargetResolved to render the target from'));
  }
  const imported = events.findLast((event) => event.type === 'Imported');
  if (imported === undefined) {
    return err(renderError('stream prefix carries no Imported to render the deposit from'));
  }

  const location = stored.event.location;
  const target = resolved.target;
  const envelope = {
    type: ACQUISITION_FULFILLED_TYPE,
    timestamp: stored.metadata.occurredAt,
    data: {
      acquisitionId: stored.streamId,
      target: {
        type: target.type,
        artist: target.artist,
        title: target.title,
        musicbrainzReleaseId: target.mbid ?? null,
        year: target.year ?? null,
        trackCount: target.tracks.length,
      },
      candidate: {
        username: imported.candidate.username,
        path: imported.candidate.path,
        sizeBytes: imported.candidate.sizeBytes,
      },
      location,
      files: (imported.files ?? []).map((file) => ({
        name: file.name,
        path: `${location}/${file.name}`,
      })),
    },
  };
  const parsed = acquisitionFulfilledEventSchema.safeParse(envelope);
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
  const checked = publishedCorrelationSchema.safeParse(correlationOf(stored));
  const metadata = checked.success ? checked.data : undefined;
  // Stryker recorded-survivor ConditionalExpression `false`: equivalent — forced to the else arm,
  // the spread adds `metadata: undefined`, and `JSON.stringify` drops an undefined property, so the
  // published bytes are identical. Asserting the key's absence would pin a distinction no consumer
  // can observe (`OutboundFeed` re-adds the key one layer out) — a test written for the score.
  return ok(metadata === undefined ? parsed.data : { ...parsed.data, metadata });
}

/** The catalog of published event types — additive: future types join here. */
export const publishedEventMapping: PublishedEventMapping = {
  publishes: (type) => type === 'DownloadFulfilled',
  render: renderFulfilled,
};

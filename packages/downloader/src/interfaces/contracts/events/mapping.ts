import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import type { StoredEvent } from '../../../application/ports/event-store-port.js';
import type {
  PublishedEvent,
  PublishedEventMapping,
  RenderError,
} from '../../../application/ports/published-events-port.js';
import { CONTEXT_NAME, isCorrelationId } from '../../../application/correlation/context.js';
import {
  ACQUISITION_FULFILLED_TYPE,
  acquisitionFulfilledEventSchema,
  publishedCorrelationSchema,
} from './schemas.js';

/**
 * The correlation envelope for a stored event, or `undefined` when the row predates the
 * capability. Never fabricated: an absent story stays absent all the way to the consumer, which
 * mints its own rather than inheriting an invented one.
 */
function correlationOf(stored: StoredEvent): Record<string, unknown> | undefined {
  const story = stored.metadata.correlationId;
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
 * Renders `acquisition.fulfilled` from the stream prefix (change: acquisition-outbound-events).
 * `AcquisitionFulfilled` alone does not carry the target/candidate detail, so the payload is
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
  if (stored.event.type !== 'AcquisitionFulfilled') {
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
  // may never stop the work. `correlationOf` yields only a well-formed block or nothing at all.
  // Validated, but never fatal. Moving the block out of the envelope's own parse (so a diagnostic
  // defect could not head-of-line-block the seam) would otherwise leave `publishedCorrelationSchema`
  // enforcing nothing at all — a rename in `correlationOf` would compile, pass every gate, and
  // silently detach every cross-context trace. So it is checked here and DROPPED on failure:
  // telemetry still cannot stop the work, and what ships is again what the contract declares.
  const block = correlationOf(stored);
  const checked = block === undefined ? undefined : publishedCorrelationSchema.safeParse(block);
  const metadata = checked?.success === true ? checked.data : undefined;
  return ok(metadata === undefined ? parsed.data : { ...parsed.data, metadata });
}

/** The catalog of published event types — additive: future types join here. */
export const publishedEventMapping: PublishedEventMapping = {
  publishes: (type) => type === 'AcquisitionFulfilled',
  render: renderFulfilled,
};

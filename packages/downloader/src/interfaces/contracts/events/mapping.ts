import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import type { StoredEvent } from '../../../application/ports/event-store-port.js';
import type {
  PublishedEvent,
  PublishedEventMapping,
  RenderError,
} from '../../../application/ports/published-events-port.js';
import { ACQUISITION_FULFILLED_TYPE, acquisitionFulfilledEventSchema } from './schemas.js';

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
  return parsed.success
    ? ok(parsed.data)
    : err(renderError(`rendered payload violates the outbound schema: ${parsed.error.message}`));
}

/** The catalog of published event types — additive: future types join here. */
export const publishedEventMapping: PublishedEventMapping = {
  publishes: (type) => type === 'AcquisitionFulfilled',
  render: renderFulfilled,
};

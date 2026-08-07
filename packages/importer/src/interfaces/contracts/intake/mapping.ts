import {
  adoptStory,
  causedBy,
  newOperation,
  toCorrelationId,
} from '../../../application/correlation/context.js';
import type { CommandContext } from '../../../application/correlation/context.js';
import type { CorrelationSource } from '../../../application/ports/system-ports.js';
import { inboundCorrelationSchema } from './schemas.js';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { toAcquisitionId } from '../../../domain/shared/acquisition-id.js';
import type { AcquisitionId } from '../../../domain/shared/acquisition-id.js';
import type { DeliveredCandidate, ImportHints } from '../../../domain/import/events.js';
import type { AcquisitionFulfilledDto } from './schemas.js';

/**
 * The anti-corruption mapping from the sender's `acquisition.fulfilled` vocabulary to the native
 * submission vocabulary, plus the path re-rooting between the two filesystem namespaces (design
 * D4): the sender's `location` must fall strictly under its configured source root, and the
 * remainder is re-joined onto the importer's own intake root.
 */

/** What an accepted delivery translates to: the acquisition linkage plus the native submission. */
export interface AcquisitionSubmission {
  readonly acquisitionId: AcquisitionId;
  /** The release directory in the SENDER's namespace, to be re-rooted before use. */
  readonly location: string;
  readonly hints: ImportHints;
  /** The delivered candidate's identity, retained for a later release verdict (if readable). */
  readonly candidate?: DeliveredCandidate;
}

export function fulfilledToSubmission(dto: AcquisitionFulfilledDto): AcquisitionSubmission {
  const { acquisitionId, location, target, candidate } = dto.data;
  return {
    // The seam schema has already proven this non-empty; lift the foreign id into its brand here.
    acquisitionId: toAcquisitionId(acquisitionId),
    location,
    hints: {
      mbReleaseId: target.musicbrainzReleaseId ?? undefined,
      artist: target.artist,
      // `title` names the release only for album targets; other kinds keep the search unpinned.
      album: target.type === 'album' ? target.title : undefined,
    },
    candidate,
  };
}

const stripTrailingSlashes = (path: string): string => path.replace(/\/+$/u, '');

/**
 * Re-root a sender-namespace location onto the importer's intake root: strip the source root and
 * join the remainder onto the intake root. A location that does not fall strictly under the
 * source root — or that carries empty/`.`/`..` segments (escape attempts) — is rejected.
 */
export function rerootLocation(arguments_: {
  readonly location: string;
  readonly sourceRoot: string;
  readonly intakeRoot: string;
}): Result<string, 'OutsideSourceRoot'> {
  const location = stripTrailingSlashes(arguments_.location);
  const prefix = `${stripTrailingSlashes(arguments_.sourceRoot)}/`;
  if (!location.startsWith(prefix)) return err('OutsideSourceRoot');
  const segments = location.slice(prefix.length).split('/');
  if (segments.some((segment) => ['', '.', '..'].includes(segment))) {
    return err('OutsideSourceRoot');
  }
  return ok(`${stripTrailingSlashes(arguments_.intakeRoot)}/${segments.join('/')}`);
}

/**
 * The command context for work triggered by a consumed seam event: the producer's story adopted
 * VERBATIM under a causation reference to the consumed event itself.
 *
 * Adoption, not translation, is the point. The anti-corruption layer translates the producer's
 * MODEL into this context's language; the correlation id is not model — it is an opaque
 * observability identity, and re-minting it here would break the single promise the capability
 * exists to keep: one id follows one operation through the whole system.
 *
 * The two failure cases are NOT the same and must not be reported as one:
 *  - **no block at all** — a producer that predates the capability. Permanent, expected, silent.
 *  - **a block this reader cannot parse** — a LIVE producer whose envelope has drifted from this
 *    reader. Every cross-context trace is broken until someone fixes it, and the symptom
 *    (traces that stop joining at the seam) is otherwise indistinguishable from the first case.
 *    That one is announced.
 *
 * Either way the delivery proceeds on a fresh story: correlation may degrade the trace, never the
 * work.
 */
export function contextForDelivery(
  metadata: unknown,
  source: CorrelationSource,
  onUnreadable: (detail: string) => void,
): CommandContext {
  if (metadata === undefined || metadata === null) return newOperation(source);
  const carried = inboundCorrelationSchema.safeParse(metadata);
  if (!carried.success) {
    onUnreadable(carried.error.message);
    return newOperation(source);
  }
  const { correlationId, causation } = carried.data;
  return adoptStory(
    toCorrelationId(correlationId),
    causedBy(causation.context, causation.streamId, causation.version),
  );
}

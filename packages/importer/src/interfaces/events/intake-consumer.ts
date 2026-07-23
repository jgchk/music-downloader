import { err, ok } from 'neverthrow';
import { findAcquisitionImport, submitImport } from '../../application/import/use-cases.js';
import type { UseCaseDependencies } from '../../application/import/use-cases.js';
import type { ConsumeHandler, SeamEvent } from '../../application/events/catch-up-subscription.js';
import { fulfilledToSubmission, rerootLocation } from '../contracts/intake/mapping.js';
import { acquisitionFulfilledSchema } from '../contracts/intake/schemas.js';

/**
 * The inbound acquisition consumer (merge-modular-monolith D3): the cross-module replacement for
 * the retired intake webhook. `acquisition.fulfilled` events arrive over the durable catch-up
 * subscription from the downloader module's outbound feed; each is read tolerantly through the
 * same consumer-owned schema, re-rooted from the sender's namespace onto the intake root, and
 * translated through the same ACL into the native submission — converging redeliveries durably by
 * acquisition id. Events of other types are acknowledged and ignored (the producer may add types
 * freely). A directory that is not visible yet is a transient failure, so the seam's at-least-once
 * redelivery retries it once the files appear; a location outside the source root is a permanent
 * rejection handled by the subscription's poison policy.
 */
export interface IntakeConsumerOptions {
  /** The sender's root prefix under which every delivered `location` must fall. */
  readonly sourceRoot: string;
  /** The importer's own intake root the stripped remainder is re-joined onto. */
  readonly intakeRoot: string;
  /** Filesystem probe injected by the composition root (the interface layer does no I/O itself). */
  readonly directoryExists: (directory: string) => Promise<boolean>;
}

export function intakeEventConsumer(
  dependencies: UseCaseDependencies,
  options: IntakeConsumerOptions,
): ConsumeHandler {
  return async (event: SeamEvent) => {
    if (event.type !== 'acquisition.fulfilled') return ok(undefined);

    const parsed = acquisitionFulfilledSchema.safeParse({ type: event.type, data: event.data });
    if (!parsed.success) {
      // A malformed payload of a known type is a producer contract defect, not a passing storm.
      return err({ kind: 'Permanent' as const, reason: 'InvalidPayload' });
    }

    const { acquisitionId, location, hints, candidate } = fulfilledToSubmission(parsed.data);
    // Durable convergence first: a redelivered acquisition no-ops even after the import applied
    // and the intake directory is long gone.
    const existing = findAcquisitionImport(dependencies, acquisitionId);
    if (existing !== undefined) return ok(undefined);

    const rerooted = rerootLocation({
      location,
      sourceRoot: options.sourceRoot,
      intakeRoot: options.intakeRoot,
    });
    if (rerooted.isErr()) {
      return err({ kind: 'Permanent' as const, reason: rerooted.error });
    }
    const directory = rerooted.value;
    let isVisible: boolean;
    try {
      isVisible = await options.directoryExists(directory);
    } catch {
      // The probe itself faulted (EACCES/EIO/…) rather than reporting "absent": a genuine infra
      // fault, held and redelivered under a distinct reason instead of masquerading as missing.
      return err({ kind: 'Transient' as const, reason: 'IntakeProbeFailed' });
    }
    if (!isVisible) {
      // Not visible (yet): transient, so the subscription holds and redelivers — a silent
      // acknowledgement here would drop the release on the floor.
      return err({ kind: 'Transient' as const, reason: 'IntakeDirectoryMissing' });
    }

    const submitted = await submitImport(dependencies, {
      directory,
      hints,
      source: { acquisitionId, candidate },
    });
    return submitted.match(
      () => ok(undefined),
      // As on the manual route: submission never fails on domain grounds — the sad paths are
      // infra faults and append races, both of which redelivery heals.
      (error) => err({ kind: 'Transient' as const, reason: error.kind }),
    );
  };
}

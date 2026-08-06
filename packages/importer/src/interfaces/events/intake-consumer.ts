import { err, ok } from 'neverthrow';
import { getImportForAcquisition, submitImport } from '../../application/import/use-cases.js';
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
 * acquisition id and FEED POSITION. Each cycle records the position of the event it imported
 * (`ImportSource.feedPosition`); an event at or before that watermark is a redelivery and
 * converges — which makes a full feed replay a total no-op — while a later position is a
 * genuinely NEW delivery: the re-hunt after a reject-unusable-delivery verdict re-delivering
 * under the same acquisition (the revival loop's last hop). A new delivery that arrives while
 * the current cycle has not yet settled (e.g. the rejection's intake deletion still owed) is
 * HELD as transient, so at-least-once redelivery lands it once the cycle settles instead of a
 * silent acknowledgement dropping it forever. Events of other types are acknowledged and
 * ignored (the producer may add types freely). A directory that is not visible yet is a
 * transient failure, so the seam's redelivery retries it once the files appear; a location
 * outside the source root is a permanent rejection handled by the subscription's poison policy.
 */
export interface IntakeConsumerOptions {
  /** The sender's root prefix under which every delivered `location` must fall. */
  readonly sourceRoot: string;
  /** The importer's own intake root the stripped remainder is re-joined onto. */
  readonly intakeRoot: string;
  /** Filesystem probe injected by the composition root (the interface layer does no I/O itself). */
  readonly directoryExists: (directory: string) => Promise<boolean>;
  /**
   * Announces the one deliberate drop this consumer can make: converging a delivery for a
   * pre-watermark stream (see below). Injected — the interface layer owns no logger of its own.
   */
  readonly warn: (context: Record<string, unknown>, message: string) => void;
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
    // Durable convergence first: an event at or before the current cycle's watermark is a
    // redelivery and no-ops, even after the import applied and the intake directory is long
    // gone. A LATER position is a new delivery and must reach the decider (which starts a
    // fresh cycle on a settled terminal — and itself converges stale positions, so this check
    // is the liveness fast-path in front of the directory probe, not the sole guard). Without
    // it, the pre-fix blanket convergence dead-ended the whole revival loop here. A watermark
    // that is absent (pre-watermark history, manual submissions) converges everything — the
    // pre-revival behavior.
    const existing = getImportForAcquisition(dependencies, acquisitionId);
    if (existing !== undefined) {
      const watermark = existing.seamWatermark;
      if (watermark === undefined) {
        // A pre-watermark stream cannot tell a redelivery from a replacement, and letting the
        // event through would duplicate a cycle on replay — so it converges, at the price of
        // dropping a genuine replacement for an import that predates the watermark. That drop
        // is deliberate and transition-scoped, but it must never be invisible: this is the one
        // branch that can discard a delivery, so it announces itself with the remediation.
        options.warn(
          { acquisitionId, globalSeq: event.globalSeq, importId: existing.importId },
          'converged a delivery for a pre-watermark import; if this was a revival replacement, resubmit the deposited directory manually',
        );
        return ok(undefined);
      }
      if (event.globalSeq <= watermark) return ok(undefined);
      if (!existing.settled) {
        // A new delivery while the current cycle is mid-flight (typically: the rejection's
        // intake deletion still owed). Converging would acknowledge — and permanently drop —
        // a delivery the user asked for; hold instead, and redelivery lands it once the cycle
        // settles. If the cycle NEVER settles (a dead-lettered deletion effect), this hold
        // stands and head-of-line-blocks the seam — visible in the subscription's error log
        // by this reason string, which says outright when the blocking cycle has dead-lettered
        // (`stalled`); bounded escalation is stalled-work-recovery's remit.
        const state =
          existing.stalled === true ? 'ExistingCycleStalled' : 'ExistingCycleNotSettled';
        return err({
          kind: 'Transient' as const,
          reason: `${state}:${acquisitionId}`,
        });
      }
    }

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
    } catch (error) {
      // The probe itself faulted (EACCES/EIO/…) rather than reporting "absent": a genuine infra
      // fault, held and redelivered under a distinct reason instead of masquerading as missing.
      // The underlying detail rides the reason string so the subscription's logs carry it.
      const detail = error instanceof Error ? error.message : String(error);
      return err({ kind: 'Transient' as const, reason: `IntakeProbeFailed: ${detail}` });
    }
    if (!isVisible) {
      // Not visible (yet): transient, so the subscription holds and redelivers — a silent
      // acknowledgement here would drop the release on the floor.
      return err({
        kind: 'Transient' as const,
        reason: `IntakeDirectoryMissing: ${directory}`,
      });
    }

    const submitted = await submitImport(dependencies, {
      directory,
      hints,
      source: { acquisitionId, candidate, feedPosition: event.globalSeq },
    });
    return submitted.match(
      () => ok(undefined),
      // Every sad path here heals on redelivery: infra faults and append races pass, and the
      // one domain refusal this command can raise — CycleInFlight, the decider's own
      // store-derived hold when a new delivery meets a live cycle (the backstop when the
      // projection's `settled` was stale) — resolves once the cycle settles.
      (error) => err({ kind: 'Transient' as const, reason: error.kind }),
    );
  };
}

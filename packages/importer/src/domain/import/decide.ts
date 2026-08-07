import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';
import type { ImportCommand } from './commands.js';
import { candidateReferenceKey } from './events.js';
import type { DuplicateIncumbent, ImportEvent, ProposedCandidate, Resolution } from './events.js';
import { isNonEmpty } from '../shared/non-empty-array.js';
import type { NonEmptyReadonlyArray } from '../shared/non-empty-array.js';
import { hasRemediation, isTerminal } from './state.js';
import type { AppliedState, AwaitingReviewState, ImportState } from './state.js';

/**
 * Protocol violations a caller can commit — the `Err` channel of `decide`. Stale or duplicate
 * *outcomes* (an effect result arriving after the stream moved on, a redelivered resolution of a
 * settled review) are not errors: they converge as an empty event list.
 */
export type DomainError =
  | { readonly kind: 'UnknownImport' }
  | { readonly kind: 'NoOpenReview' }
  | { readonly kind: 'InvalidResolution'; readonly detail: string }
  | { readonly kind: 'UnknownCandidate'; readonly candidate: string }
  /** reject-unusable-delivery needs a retained delivered candidate; this import has none. */
  | { readonly kind: 'NoRetainedCandidate' }
  /**
   * A NEW seam delivery (position past the stream watermark) arrived while a cycle is still in
   * flight. Converging would acknowledge — and permanently drop — the delivery, so the caller
   * must hold and retry once the cycle settles (the seam consumer maps this to its transient
   * hold). Distinct from a stale redelivery, which converges silently.
   */
  | { readonly kind: 'CycleInFlight' };

type Decision = Result<readonly ImportEvent[], DomainError>;

const NOTHING: Decision = ok([]);

/** The lowest-distance candidate — beets' ordering, re-derived so `decide` never trusts input order. */
function bestOf(candidates: NonEmptyReadonlyArray<ProposedCandidate>): ProposedCandidate {
  let best = candidates[0];
  for (const next of candidates) {
    if (next.distance < best.distance) best = next;
  }
  return best;
}

/**
 * Is this submission a NEW delivery for the stream? Only a sourced submission is a delivery at all
 * (a manual resubmission carries no position and is never one), and it is new when it sits past
 * every position the stream ever recorded — or when the stream has no watermark to compare against.
 * Anything else is a redelivery of a position this stream has already run.
 *
 * The one place the rule is written down, because `decide` needs it in both directions: a live
 * cycle refuses a new delivery, and a settled one converges everything that is not new.
 */
function isNewDelivery(watermark: number | undefined, incoming: number | undefined): boolean {
  if (incoming === undefined) return false;
  return watermark === undefined || incoming > watermark;
}

function decideProposal(
  state: ImportState,
  candidates: readonly ProposedCandidate[],
  duplicates: readonly DuplicateIncumbent[],
  pinnedId: string | undefined,
): Decision {
  if (state.phase !== 'requested' && state.phase !== 'proposing') return NOTHING; // stale outcome
  const proposed: ImportEvent = { type: 'CandidatesProposed', candidates, duplicates, pinnedId };
  if (!isNonEmpty(candidates)) {
    return ok([proposed, { type: 'ReviewRequired', cause: { kind: 'no-match' } }]);
  }
  const best = bestOf(candidates);
  // The release id in play for this proposal, if any: the just-supplied pin, the one folded from a
  // prior supply-id re-propose, or the original submission hint. `hinted` stays exactly its old
  // boolean (an id was in play); the id itself rides along so a reader can tell a contradicted hint
  // (best candidate's album id differs) from a merely-weak match on the pinned release.
  const hintedReleaseId = pinnedId ?? state.pinnedId ?? state.hints?.mbReleaseId;
  const isHinted = hintedReleaseId !== undefined;
  if (best.distance > state.policy.autoApplyThreshold) {
    // A weak — or hint-contradicted — match goes to a human with the evidence: the candidate list
    // rides on `CandidatesProposed`, each candidate carrying its field-level diff (current-vs-proposed
    // tags, extra/missing tracks, album fields), with the distance penalties kept as a summary.
    return ok([
      proposed,
      {
        type: 'ReviewRequired',
        cause: { kind: 'match-review', hinted: isHinted, hintedReleaseId, best: best.ref },
      },
    ]);
  }
  if (isNonEmpty(duplicates)) {
    // Strong match, but the library already has it: never auto-replace in this change (D5).
    return ok([
      proposed,
      { type: 'ReviewRequired', cause: { kind: 'duplicate-review', incumbents: duplicates } },
    ]);
  }
  return ok([proposed, { type: 'AutoApplySelected', ref: best.ref, distance: best.distance }]);
}

function decideResolutionForReview(state: AwaitingReviewState, resolution: Resolution): Decision {
  if (state.settled !== undefined) return NOTHING; // redelivered resolution converges
  if (resolution.kind === 'accept' || resolution.kind === 'retry-enrichment') {
    return err({
      kind: 'InvalidResolution',
      detail: `${resolution.kind} resolves a remediation review, not a ${state.cause.kind}`,
    });
  }
  if (resolution.kind === 'apply-candidate') {
    const isKnown = state.candidates.some(
      (candidate) => candidateReferenceKey(candidate.ref) === candidateReferenceKey(resolution.ref),
    );
    if (!isKnown)
      return err({ kind: 'UnknownCandidate', candidate: candidateReferenceKey(resolution.ref) });
  } else if (resolution.kind === 'reject-unusable-delivery') {
    // The verdict echoes back the exact copy the importer judged (opaque provenance for the
    // consumer); without a retained candidate the verb is refused precisely — plain reject stays
    // available.
    const source = state.source;
    if (source?.candidate === undefined) return err({ kind: 'NoRetainedCandidate' });
    return ok([
      { type: 'ReviewResolved', resolution },
      {
        type: 'ReleaseVerdictRecorded',
        acquisitionId: source.acquisitionId,
        candidate: source.candidate,
        reasons: resolution.reasons ?? [],
      },
    ]);
  }
  return ok([{ type: 'ReviewResolved', resolution }]);
}

function decideResolutionForApplied(state: AppliedState, resolution: Resolution): Decision {
  if (state.remediation?.status !== 'open') return NOTHING;
  if (resolution.kind !== 'accept' && resolution.kind !== 'retry-enrichment') {
    return err({
      kind: 'InvalidResolution',
      detail: `a remediation review resolves through accept or retry-enrichment, not ${resolution.kind}`,
    });
  }
  return ok([{ type: 'ReviewResolved', resolution }]);
}

function decideResolution(state: ImportState, resolution: Resolution): Decision {
  switch (state.phase) {
    case 'empty': {
      return err({ kind: 'UnknownImport' });
    }
    case 'requested': {
      return err({ kind: 'NoOpenReview' });
    }
    case 'awaiting-review': {
      return decideResolutionForReview(state, resolution);
    }
    case 'applied': {
      return decideResolutionForApplied(state, resolution);
    }
    // A resolution already in motion (re-proposing, applying) or a settled rejection: converge.
    case 'proposing':
    case 'applying':
    case 'rejected': {
      return NOTHING;
    }
  }
}

/**
 * The single decision point: a command against the folded state yields the events to append, an
 * empty list for a stale/duplicate outcome, or a `DomainError` for a protocol violation.
 */
export function decide(command: ImportCommand, state: ImportState): Decision {
  switch (command.type) {
    case 'SubmitImport': {
      // Idempotent by stream, with the seam watermark (the max feed position any cycle ever
      // recorded) deciding what counts as new. On a LIVE cycle: an unsourced or stale-position
      // submission converges on the cycle itself, but a NEW delivery (past the watermark, or
      // sourced onto a stream with no watermark) must not be swallowed — the cycle in flight
      // will settle, and only a refusal lets the caller hold and land it afterwards. On a
      // settled terminal: a stale-position submission converges (a full feed replay is a
      // no-op; no caller — a second consumer, a redrive — can duplicate a cycle for a delivery
      // the stream has already seen), anything else starts a fresh cycle for the re-deposited
      // directory. The watermarked guarantees cover watermarked streams only: pre-watermark
      // history has nothing to compare, so a sourced resubmission onto a pre-watermark
      // terminal starts a fresh cycle — the shipped consumer's converge-first ordering is
      // what protects that legacy population.
      const incoming = command.source?.feedPosition;
      const watermark = state.seamWatermark;
      if (state.phase !== 'empty' && !isTerminal(state)) {
        if (isNewDelivery(watermark, incoming)) return err({ kind: 'CycleInFlight' });
        return NOTHING;
      }
      // Settled or fresh: a delivery the stream has already seen converges. A manual resubmission
      // carries no position at all, so it is never compared and always starts a fresh cycle.
      if (incoming !== undefined && !isNewDelivery(watermark, incoming)) return NOTHING;
      return ok([
        {
          type: 'ImportRequested',
          directory: command.directory,
          hints: command.hints,
          policy: command.policy,
          source: command.source,
        },
      ]);
    }
    case 'RecordProposal': {
      return decideProposal(state, command.candidates, command.duplicates, command.pinnedId);
    }
    case 'RecordApplied': {
      const isRetrying = hasRemediation(state, 'retrying');
      if (!isRetrying && state.phase !== 'applying') return NOTHING; // stale outcome
      const applied: ImportEvent = { type: 'ImportApplied', location: command.location };
      return ok(
        isNonEmpty(command.failures)
          ? [applied, { type: 'RemediationRequired', failures: command.failures }]
          : [applied],
      );
    }
    case 'RecordApplySkippedDuplicate': {
      // Beets refused to import over an incumbent it only saw at apply time: route to review.
      if (state.phase !== 'applying') return NOTHING;
      if (!isNonEmpty(command.incumbents)) {
        // A skipped-duplicate with no incumbent is contradictory: there is nothing to compare in a
        // duplicate review, and the import must not strand in `applying`. Doom it (terminal, files
        // untouched) so the deposited directory can be investigated and resubmitted.
        return ok([
          {
            type: 'ImportRejected',
            reason: 'beets skipped the apply as a duplicate but reported no incumbent',
            filesDeleted: false,
          },
        ]);
      }
      return ok([
        {
          type: 'ReviewRequired',
          cause: { kind: 'duplicate-review', incumbents: command.incumbents },
        },
      ]);
    }
    case 'RecordIntakeDeleted': {
      if (state.phase !== 'awaiting-review') return NOTHING;
      const settled = state.settled;
      if (settled === undefined) return NOTHING; // review resolved to a non-terminal verb; nothing owed
      // Exhaustive over the two reject verbs `settled` can hold; a new rejection verb is a compile
      // error here rather than a silent NOTHING that would leave the intake undeleted forever.
      switch (settled.kind) {
        case 'reject': {
          const reason = settled.reason ?? 'rejected by review';
          return ok([{ type: 'ImportRejected', reason, filesDeleted: true }]);
        }
        case 'reject-unusable-delivery': {
          const reasons = settled.reasons ?? [];
          const reason = reasons.length > 0 ? reasons.join('; ') : 'rejected by review';
          return ok([{ type: 'ImportRejected', reason, filesDeleted: true }]);
        }
      }
    }
    case 'RecordDoomed': {
      // A permanent effect failure dooms the import (D7): terminal `rejected`, files untouched.
      if (state.phase === 'empty' || isTerminal(state)) return NOTHING;
      return ok([{ type: 'ImportRejected', reason: command.reason, filesDeleted: false }]);
    }
    case 'ResolveReview': {
      return decideResolution(state, command.resolution);
    }
  }
}

import type {
  ApplyFailure,
  ApplyMode,
  ImportEvent,
  ImportHints,
  ImportPolicy,
  ImportSource,
  MetadataMatch,
  Resolution,
  ReviewCause,
} from './events.js';
import type { NonEmptyReadonlyArray } from '../shared/non-empty-array.js';

/**
 * The folded state of one import (the sole aggregate), modelled as a discriminated union on
 * {@link ImportPhase} so each phase carries exactly the fields valid in it. `evolve` is a pure,
 * total fold over the event history: it never fails, performs no I/O, and ignores any event that
 * does not fit the current phase (a corrupt or externally-edited history degrades to a foldable
 * state rather than throwing). Business intelligence lives in `decide`, not here.
 */
export type ImportPhase =
  | 'empty' // no import yet
  | 'requested' // submitted; the initial proposal is in flight
  | 'proposing' // a re-proposal (supply-id / refresh) is in flight
  | 'awaiting-review' // a typed review item waits for a human
  | 'applying' // beets is applying a chosen outcome
  | 'applied' // terminal for the files; may carry an open remediation review
  | 'rejected'; // terminal

/** Facts carried by every phase past `empty`. */
interface Requested {
  readonly directory: string;
  readonly hints?: ImportHints;
  readonly policy: ImportPolicy;
  /** Provenance of an event-driven submission, incl. the retained delivered candidate (if any). */
  readonly source?: ImportSource;
  /**
   * The STREAM's seam convergence watermark: the highest `ImportSource.feedPosition` any cycle
   * of this stream ever recorded. Folded as a max across cycles — deliberately not the current
   * cycle's own position — so a manual resubmission (which carries no source) cannot erase the
   * watermark and reopen the stream to redeliveries of already-imported deliveries.
   */
  readonly seamWatermark?: number;
}

/** The remediation review riding on an applied import (D7). */
export interface RemediationState {
  readonly failures: NonEmptyReadonlyArray<ApplyFailure>;
  readonly status: 'open' | 'retrying';
}

export interface EmptyState {
  readonly phase: 'empty';
  /**
   * Declared, and only ever absent: a stream with no cycle has recorded no delivery. Stating the
   * absence here — rather than narrowing on the phase at every read — makes `seamWatermark`
   * uniformly readable across the whole union, and removes three copies of a guard that only ever
   * satisfied the type checker (the unguarded read yields `undefined` on this phase either way).
   */
  readonly seamWatermark?: undefined;
}
export interface RequestedState extends Requested {
  readonly phase: 'requested';
  readonly candidates: readonly MetadataMatch[];
  /**
   * Never pinned: a pin can only arrive on the `supply-id` that moves the import to `proposing`.
   *
   * Same declared-absent idiom as {@link EmptyState.seamWatermark}, but a NARROWER claim — do not
   * read it as making `pinnedId` readable across the whole union. `seamWatermark` is declared on
   * every member; this one only makes the pair `requested | proposing` uniform, which is exactly
   * the pair `decideProposal` has already narrowed to before it reads the field. The other five
   * phases stay silent about pins because `requestedOf` drops the field when it rebuilds them.
   */
  readonly pinnedId?: undefined;
}
export interface ProposingState extends Requested {
  readonly phase: 'proposing';
  readonly pinnedId?: string;
  readonly candidates: readonly MetadataMatch[];
}
/**
 * The only resolutions that leave the review `awaiting-review` with work still owed: both reject
 * verbs settle the review but hold the phase until `ImportRejected` records the intake deletion.
 * Every other verb transitions the import away, so `settled` can only ever hold one of these two.
 */
export type PendingRejection = Extract<
  Resolution,
  { kind: 'reject' } | { kind: 'reject-unusable-delivery' }
>;

export interface AwaitingReviewState extends Requested {
  readonly phase: 'awaiting-review';
  readonly cause: ReviewCause;
  readonly candidates: readonly MetadataMatch[];
  /** Set once a rejection is recorded; the deletion is still owed. Further resolutions are no-ops. */
  readonly settled?: PendingRejection;
}
export interface ApplyingState extends Requested {
  readonly phase: 'applying';
  readonly mode: ApplyMode;
  readonly candidates: readonly MetadataMatch[];
}
export interface AppliedState extends Requested {
  readonly phase: 'applied';
  readonly location: string;
  readonly mode: ApplyMode;
  readonly remediation?: RemediationState;
}
export interface RejectedState extends Requested {
  readonly phase: 'rejected';
  readonly reason: string;
  readonly filesDeleted: boolean;
}

export type ImportState =
  | EmptyState
  | RequestedState
  | ProposingState
  | AwaitingReviewState
  | ApplyingState
  | AppliedState
  | RejectedState;

export const initialState: EmptyState = { phase: 'empty' };

/** Terminal for the submitted files: they either entered the library or were deleted. */
export function isTerminal(state: ImportState): boolean {
  return state.phase === 'applied' || state.phase === 'rejected';
}

/** An applied import carrying a remediation review that is in `S`. */
export type RemediatingState<S extends RemediationState['status'] = RemediationState['status']> =
  AppliedState & { readonly remediation: RemediationState & { readonly status: S } };

/**
 * Is this import's remediation review in `status`? Stated once, because `remediation` is declared on
 * {@link AppliedState} alone: every question about it is also a question about the phase, and four
 * callers were spelling that pairing out for themselves.
 *
 * The predicate narrows to the status it was asked about, not merely to "a remediation is present" —
 * so `hasRemediation(s, 'open')` and `hasRemediation(s, 'retrying')` yield different types, as the
 * signature implies. Worth stating narrowly from the start: this is exported surface, and tightening
 * a public predicate later is a breaking change.
 */
export function hasRemediation<S extends RemediationState['status']>(
  state: ImportState,
  status: S,
): state is RemediatingState<S> {
  // Presence, not phase: `remediation` is declared on `AppliedState` alone, so `in` asks the same
  // question in one operand rather than two — and unlike a phase comparison it leaves behind no
  // mutant no test can distinguish (an unguarded `state.remediation` reads `undefined` on every
  // other phase, so forcing a phase operand true would change nothing anywhere).
  return 'remediation' in state && state.remediation?.status === status;
}

function requestedOf(state: Exclude<ImportState, EmptyState>): Requested {
  return {
    directory: state.directory,
    hints: state.hints,
    policy: state.policy,
    source: state.source,
    seamWatermark: state.seamWatermark,
  };
}

/**
 * Fold a review resolution into the next phase. An exhaustive `switch` over the resolution verb
 * (with a total, non-optional return): a new verb is a compile error here — `noImplicitReturns`
 * refuses the silent fall-through that would otherwise strand the import in `awaiting-review`.
 */
function evolveResolved(state: AwaitingReviewState, resolution: Resolution): ImportState {
  const applying = (mode: ApplyMode): ImportState => ({
    phase: 'applying',
    ...requestedOf(state),
    mode,
    candidates: state.candidates,
  });
  switch (resolution.kind) {
    case 'apply-candidate': {
      return applying({
        kind: 'candidate',
        ref: resolution.ref,
        duplicateAction: resolution.duplicateAction,
      });
    }
    case 'import-as-is': {
      return applying({ kind: 'as-is' });
    }
    case 'manual-tags': {
      return applying({ kind: 'manual-tags', tags: resolution.tags });
    }
    case 'supply-id': {
      return {
        phase: 'proposing',
        ...requestedOf(state),
        pinnedId: resolution.mbReleaseId,
        candidates: state.candidates,
      };
    }
    case 'refresh-candidates': {
      return { phase: 'proposing', ...requestedOf(state), candidates: state.candidates };
    }
    case 'reject':
    case 'reject-unusable-delivery': {
      // The review is settled; the intake deletion is still owed, so the phase holds until
      // `ImportRejected` records the outcome.
      return { ...state, settled: resolution };
    }
    case 'accept':
    case 'retry-enrichment': {
      // Never reached: `decide` refuses these outside an open remediation. Fold to a defensive
      // no-op rather than an illegal `settled`.
      return state;
    }
  }
}

/** The stream watermark folds as a max across cycles; absent only when both sides are absent. */
function maxWatermark(
  previous: number | undefined,
  incoming: number | undefined,
): number | undefined {
  if (previous === undefined) return incoming;
  if (incoming === undefined) return previous;
  return Math.max(previous, incoming);
}

export function evolve(state: ImportState, event: ImportEvent): ImportState {
  switch (event.type) {
    case 'ImportRequested': {
      // A fresh cycle begins from nothing or from a settled terminal (the same directory can be
      // re-deposited and resubmitted after a rejection or a completed import).
      if (state.phase !== 'empty' && !isTerminal(state)) return state;
      return {
        phase: 'requested',
        directory: event.directory,
        hints: event.hints,
        policy: event.policy,
        source: event.source,
        seamWatermark: maxWatermark(state.seamWatermark, event.source?.feedPosition),
        candidates: [],
      };
    }
    case 'MatchesProposed': {
      // The phase advances via the co-emitted `AutoApplySelected`/`ReviewRequired`; the proposed
      // list is recorded here so the following states carry it.
      if (state.phase !== 'requested' && state.phase !== 'proposing') return state;
      return { ...state, candidates: event.candidates };
    }
    case 'AutoApplySelected': {
      if (state.phase !== 'requested' && state.phase !== 'proposing') return state;
      return {
        phase: 'applying',
        ...requestedOf(state),
        mode: { kind: 'candidate', ref: event.ref },
        candidates: state.candidates,
      };
    }
    case 'ReviewRequired': {
      if (
        state.phase !== 'requested' &&
        state.phase !== 'proposing' &&
        state.phase !== 'applying'
      ) {
        return state;
      }
      return {
        phase: 'awaiting-review',
        ...requestedOf(state),
        cause: event.cause,
        candidates: state.candidates,
      };
    }
    case 'ReviewResolved': {
      if (state.phase === 'awaiting-review' && state.settled === undefined) {
        return evolveResolved(state, event.resolution);
      }
      if (hasRemediation(state, 'open')) {
        // Remediation verbs: accept closes the item; retry-enrichment marks the re-apply in flight.
        return event.resolution.kind === 'retry-enrichment'
          ? { ...state, remediation: { failures: state.remediation.failures, status: 'retrying' } }
          : { ...state, remediation: undefined };
      }
      return state;
    }
    case 'ImportApplied': {
      if (state.phase === 'applying') {
        return {
          phase: 'applied',
          ...requestedOf(state),
          location: event.location,
          mode: state.mode,
        };
      }
      // A retried enrichment re-applied: refresh the location and clear the remediation.
      if (state.phase === 'applied') {
        return { ...state, location: event.location, remediation: undefined };
      }
      return state;
    }
    case 'RemediationRequired': {
      if (state.phase !== 'applied') return state;
      return { ...state, remediation: { failures: event.failures, status: 'open' } };
    }
    case 'ImportRejected': {
      if (state.phase === 'empty' || isTerminal(state)) return state;
      return {
        phase: 'rejected',
        ...requestedOf(state),
        reason: event.reason,
        filesDeleted: event.filesDeleted,
      };
    }
    case 'ReleaseVerdictRecorded': {
      // A record-only fact for the outbound publisher: it changes no import state.
      return state;
    }
  }
}

/** Fold a whole history into state — the replay path and a convenient test builder. */
export function foldEvents(events: readonly ImportEvent[]): ImportState {
  let state: ImportState = initialState;
  for (const event of events) state = evolve(state, event);
  return state;
}

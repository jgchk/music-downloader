import { candidateKey } from '../candidate/candidate.js';
import type { Candidate } from '../candidate/candidate.js';
import type { AcquisitionPolicies } from '../policy/policies.js';
import type { RankedCandidate } from '../ranking/ranking.js';
import type { Target } from '../target/target.js';
import type {
  AcquisitionEvent,
  AcquisitionRequest,
  DownloadedFile,
  EditionCandidate,
} from './events.js';

/**
 * The folded state of one acquisition (the sole aggregate, D1), modelled as a discriminated union
 * on {@link AcquisitionPhase} so that each phase carries exactly the fields valid in it — invalid
 * states are unrepresentable. `evolve` is a pure, total fold over the event history: it never fails,
 * performs no I/O, and ignores any event that does not fit the current phase (so a corrupt or
 * externally-edited history degrades to a foldable state rather than throwing). Business
 * intelligence lives in `decide`, not here.
 */
export type AcquisitionPhase =
  | 'Empty' // no acquisition yet
  | 'Pending' // requested, resolving metadata
  | 'AwaitingManualSelection' // paused: a human must choose among the retained candidate editions
  | 'Searching' // awaiting search results
  | 'Selecting' // ranked working set in hand, none in flight
  | 'Downloading' // one candidate in flight
  | 'Validating' // downloaded, awaiting validation
  | 'Importing' // validated, awaiting import
  | 'Fulfilled' // terminal, stable-but-defeasible: an external verdict may revive it (see FulfilledState)
  | 'Exhausted' // terminal, absorbing
  | 'Cancelled' // terminal, absorbing
  | 'MetadataFailed' // terminal, absorbing
  | 'Conflicted'; // terminal, absorbing

// --- Shared payload bases: fields accrete as an acquisition advances through its phases. ---

/** History facts carried by every phase past `Empty`. */
interface Progress {
  readonly rejected: readonly string[]; // candidate identity keys already rejected
  readonly searchRounds: number;
  readonly attempts: number; // download attempts made
}
/** A request accepted: the intent and the policies that govern it. */
interface Requested extends Progress {
  readonly request: AcquisitionRequest;
  readonly policies: AcquisitionPolicies;
}
/** Metadata resolved: a concrete target to search for. */
interface Targeted extends Requested {
  readonly target: Target;
}

// --- The phase variants. ---

export interface EmptyState {
  readonly phase: 'Empty';
}
export interface PendingState extends Requested {
  readonly phase: 'Pending';
}
/**
 * Paused for a human's edition choice (manual-edition-selection D2): resolution found editions but
 * no official one, so the candidates are retained and nothing searches, downloads, or imports
 * until a `SelectEdition` or a cancellation.
 */
export interface AwaitingManualSelectionState extends Requested {
  readonly phase: 'AwaitingManualSelection';
  readonly candidates: readonly EditionCandidate[];
}
export interface SearchingState extends Targeted {
  readonly phase: 'Searching';
}
export interface SelectingState extends Targeted {
  readonly phase: 'Selecting';
  readonly working: readonly RankedCandidate[]; // untried, ranked candidates
}
export interface DownloadingState extends Targeted {
  readonly phase: 'Downloading';
  readonly working: readonly RankedCandidate[];
  readonly current: Candidate; // the candidate currently in flight
}
export interface ValidatingState extends Targeted {
  readonly phase: 'Validating';
  readonly working: readonly RankedCandidate[];
  readonly current: Candidate;
  readonly downloadedFiles: readonly DownloadedFile[];
}
export interface ImportingState extends Targeted {
  readonly phase: 'Importing';
  readonly working: readonly RankedCandidate[];
  readonly current: Candidate;
  readonly downloadedFiles: readonly DownloadedFile[];
}
export interface MetadataFailedState extends Requested {
  readonly phase: 'MetadataFailed';
}
/**
 * The ladder-resume context a fulfilment retains (fulfillment-external-verdict D3): the fulfilled
 * candidate — whose identity is the stale-guard for external verdicts — and everything needed to
 * re-enter the retry ladder should that candidate be rejected after delivery. Retained only when
 * the `AcquisitionFulfilled` event names its candidate; a legacy fulfilment folds without it and
 * cannot be revived — the correct degraded behavior.
 */
export interface FulfilledResume {
  readonly request: AcquisitionRequest;
  readonly policies: AcquisitionPolicies;
  readonly target: Target;
  readonly working: readonly RankedCandidate[]; // untried candidates, still ranked
  readonly candidate: Candidate; // the fulfilled candidate
}
/**
 * Fulfilled is terminal for every existing purpose (`isTerminal` reports true), yet stable-but-
 * defeasible rather than absorbing (D2): one command — an external validation failure naming the
 * retained candidate — may revive it into the retry ladder via `FulfillmentRejected`. All other
 * terminal phases stay absorbing.
 */
export interface FulfilledState extends Progress {
  readonly phase: 'Fulfilled';
  readonly location: string; // library location once imported
  readonly resume?: FulfilledResume;
}
export interface ConflictedState extends Progress {
  readonly phase: 'Conflicted';
  readonly location: string; // the occupied library location left untouched
  readonly current: Candidate; // whose staged files must still be cleaned up
}
export interface ExhaustedState extends Progress {
  readonly phase: 'Exhausted';
}
/**
 * What a cancellation retained of the acquisition's transfer — at most one candidate, and the two
 * cases demand opposite handling, so they are a sub-union rather than two independent optionals
 * (both-present is unrepresentable, not merely never-constructed):
 * - `settled` — cancelled after the transfer settled (Validating/Importing): staged files to clean up.
 * - `in-flight` — cancelled mid-download: abort the transfer first, then clean up once it settles.
 * - `none` — nothing was in flight (or an in-flight transfer has since settled and been cleared).
 */
export type CancelledStaging =
  | { readonly kind: 'none' }
  | { readonly kind: 'settled'; readonly current: Candidate }
  | { readonly kind: 'in-flight'; readonly pending: Candidate };

export interface CancelledState extends Progress {
  readonly phase: 'Cancelled';
  readonly staging: CancelledStaging;
}

export type AcquisitionState =
  | EmptyState
  | PendingState
  | AwaitingManualSelectionState
  | SearchingState
  | SelectingState
  | DownloadingState
  | ValidatingState
  | ImportingState
  | MetadataFailedState
  | FulfilledState
  | ConflictedState
  | ExhaustedState
  | CancelledState;

export const initialState: EmptyState = { phase: 'Empty' };

const TERMINAL_PHASES: ReadonlySet<AcquisitionPhase> = new Set<AcquisitionPhase>([
  'Fulfilled',
  'Exhausted',
  'Cancelled',
  'MetadataFailed',
  'Conflicted',
]);

export function isTerminal(state: AcquisitionState): boolean {
  return TERMINAL_PHASES.has(state.phase);
}

/** The progress counters, defaulted to zero for the empty state. */
function progressOf(state: AcquisitionState): Progress {
  if (state.phase === 'Empty') {
    return { rejected: [], searchRounds: 0, attempts: 0 };
  }
  return { rejected: state.rejected, searchRounds: state.searchRounds, attempts: state.attempts };
}

export function evolve(state: AcquisitionState, event: AcquisitionEvent): AcquisitionState {
  switch (event.type) {
    case 'AcquisitionRequested':
      if (state.phase !== 'Empty') return state;
      return {
        phase: 'Pending',
        request: event.request,
        policies: event.policies,
        rejected: [],
        searchRounds: 0,
        attempts: 0,
      };
    case 'TargetResolved':
      if (state.phase !== 'Pending') return state;
      return { ...state, phase: 'Searching', target: event.target };
    case 'MetadataResolutionFailed':
      if (state.phase !== 'Pending') return state;
      return { ...state, phase: 'MetadataFailed' };
    case 'ManualSelectionRequested':
      if (state.phase !== 'Pending') return state;
      return { ...state, phase: 'AwaitingManualSelection', candidates: event.candidates };
    case 'EditionSelected': {
      // Back to Pending: the chosen release id is being resolved, exactly like a fresh resolution.
      // The candidates are dropped — they were only ever the menu for this choice.
      if (state.phase !== 'AwaitingManualSelection') return state;
      const { candidates: _candidates, ...requested } = state;
      return { ...requested, phase: 'Pending' };
    }
    case 'SearchRequested':
      if (state.phase !== 'Selecting') return state;
      return {
        phase: 'Searching',
        request: state.request,
        policies: state.policies,
        target: state.target,
        rejected: state.rejected,
        searchRounds: state.searchRounds,
        attempts: state.attempts,
      };
    case 'SearchCompleted':
      if (state.phase !== 'Searching') return state;
      return { ...state, searchRounds: state.searchRounds + 1 };
    case 'CandidatesRanked':
      if (state.phase !== 'Searching') return state;
      return { ...state, phase: 'Selecting', working: event.ranked };
    case 'CandidateSelected':
      if (state.phase !== 'Selecting') return state;
      return {
        ...state,
        phase: 'Downloading',
        current: event.candidate,
        working: state.working.filter(
          (ranked) =>
            candidateKey(ranked.candidate.identity) !== candidateKey(event.candidate.identity),
        ),
        attempts: state.attempts + 1,
      };
    case 'DownloadCompleted':
      if (state.phase !== 'Downloading') return state;
      return { ...state, phase: 'Validating', downloadedFiles: event.files };
    case 'DownloadFailed':
      return state; // the following CandidateRejected does the state work
    case 'CandidateRejected':
      // A cancelled acquisition whose mid-download candidate has now settled: drop `pending` so the
      // deferred cleanup fires once (via `react`) and any later settlement report is a no-op.
      if (state.phase === 'Cancelled') {
        return state.staging.kind === 'in-flight'
          ? { phase: 'Cancelled', staging: { kind: 'none' }, ...progressOf(state) }
          : state;
      }
      if (state.phase !== 'Downloading' && state.phase !== 'Validating') return state;
      return {
        phase: 'Selecting',
        request: state.request,
        policies: state.policies,
        target: state.target,
        working: state.working,
        rejected: [...state.rejected, candidateKey(event.candidate)],
        searchRounds: state.searchRounds,
        attempts: state.attempts,
      };
    case 'ValidationPassed':
      if (state.phase !== 'Validating') return state;
      return { ...state, phase: 'Importing' };
    case 'ValidationFailed':
      return state; // the following CandidateRejected does the state work
    case 'Imported':
      // A state no-op: the co-emitted AcquisitionFulfilled carries the location; the import itself
      // is observed via `react` (staging cleanup), not folded into state.
      return state;
    case 'AcquisitionFulfilled': {
      if (state.phase !== 'Importing') return state;
      const fulfilled: FulfilledState = {
        phase: 'Fulfilled',
        location: event.location,
        rejected: state.rejected,
        searchRounds: state.searchRounds,
        attempts: state.attempts,
      };
      // A fulfilment that names its candidate retains the ladder-resume context (D3); a legacy
      // event that does not folds to an unrevivable Fulfilled state.
      if (event.candidate === undefined) return fulfilled;
      return {
        ...fulfilled,
        resume: {
          request: state.request,
          policies: state.policies,
          target: state.target,
          working: state.working,
          candidate: state.current,
        },
      };
    }
    case 'FulfillmentRejected': {
      // The revival edge (D1/D2): a Fulfilled acquisition with retained context re-enters the
      // ladder as if its candidate had just failed validation; the co-emitted rejection/selection
      // events then fold through the existing cases. Nothing is staged any more (the files were
      // imported), so the transient Validating state carries no downloaded files.
      if (state.phase !== 'Fulfilled' || state.resume === undefined) return state;
      const resume = state.resume;
      return {
        phase: 'Validating',
        request: resume.request,
        policies: resume.policies,
        target: resume.target,
        working: resume.working,
        current: resume.candidate,
        downloadedFiles: [],
        rejected: state.rejected,
        searchRounds: state.searchRounds,
        attempts: state.attempts,
      };
    }
    case 'AcquisitionExhausted':
      if (state.phase !== 'Selecting') return state;
      return {
        phase: 'Exhausted',
        rejected: state.rejected,
        searchRounds: state.searchRounds,
        attempts: state.attempts,
      };
    case 'ImportConflicted':
      if (state.phase !== 'Importing') return state;
      return {
        phase: 'Conflicted',
        location: event.location,
        current: state.current,
        rejected: state.rejected,
        searchRounds: state.searchRounds,
        attempts: state.attempts,
      };
    case 'AcquisitionCancelled':
      if (isTerminal(state)) return state;
      // A settled transfer's files are staged and stable — retain the candidate for immediate
      // cleanup. An in-flight Downloading transfer is still being written — retain it as `pending`
      // so the transfer is first aborted, then cleaned up once it settles (never both at once).
      if (state.phase === 'Validating' || state.phase === 'Importing') {
        return {
          phase: 'Cancelled',
          staging: { kind: 'settled', current: state.current },
          ...progressOf(state),
        };
      }
      if (state.phase === 'Downloading') {
        return {
          phase: 'Cancelled',
          staging: { kind: 'in-flight', pending: state.current },
          ...progressOf(state),
        };
      }
      return { phase: 'Cancelled', staging: { kind: 'none' }, ...progressOf(state) };
  }
}

/** Fold a whole history into state — the replay path and a convenient test builder. */
export function foldEvents(events: readonly AcquisitionEvent[]): AcquisitionState {
  return events.reduce(evolve, initialState);
}

import { candidateKey } from '../candidate/candidate.js';
import type { Candidate } from '../candidate/candidate.js';
import type { AcquisitionPolicies } from '../policy/policies.js';
import type { RankedCandidate } from '../ranking/ranking.js';
import type { Target } from '../target/target.js';
import type { AcquisitionEvent, AcquisitionRequest, DownloadedFile } from './events.js';

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
  | 'Searching' // awaiting search results
  | 'Selecting' // ranked working set in hand, none in flight
  | 'Downloading' // one candidate in flight
  | 'Validating' // downloaded, awaiting validation
  | 'Importing' // validated, awaiting import
  | 'Fulfilled' // terminal
  | 'Exhausted' // terminal
  | 'Cancelled' // terminal
  | 'MetadataFailed' // terminal
  | 'Conflicted'; // terminal

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
export interface FulfilledState extends Progress {
  readonly phase: 'Fulfilled';
  readonly location: string; // library location once imported
}
export interface ConflictedState extends Progress {
  readonly phase: 'Conflicted';
  readonly location: string; // the occupied library location left untouched
  readonly current: Candidate; // whose staged files must still be cleaned up
}
export interface ExhaustedState extends Progress {
  readonly phase: 'Exhausted';
}
export interface CancelledState extends Progress {
  readonly phase: 'Cancelled';
  readonly current?: Candidate; // present only when cancelled after the transfer settled (D: Validating/Importing)
}

export type AcquisitionState =
  | EmptyState
  | PendingState
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
    case 'AcquisitionFulfilled':
      if (state.phase !== 'Importing') return state;
      return {
        phase: 'Fulfilled',
        location: event.location,
        rejected: state.rejected,
        searchRounds: state.searchRounds,
        attempts: state.attempts,
      };
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
      // Retain the in-flight candidate only when its transfer has settled (files are staged and
      // stable); an in-flight Downloading transfer is still being written, so cleaning it is unsafe.
      if (state.phase === 'Validating' || state.phase === 'Importing') {
        return { phase: 'Cancelled', current: state.current, ...progressOf(state) };
      }
      return { phase: 'Cancelled', ...progressOf(state) };
  }
}

/** Fold a whole history into state — the replay path and a convenient test builder. */
export function foldEvents(events: readonly AcquisitionEvent[]): AcquisitionState {
  return events.reduce(evolve, initialState);
}

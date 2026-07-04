import { candidateKey } from '../candidate/candidate.js';
import type { Candidate } from '../candidate/candidate.js';
import type { AcquisitionPolicies } from '../policy/policies.js';
import type { RankedCandidate } from '../ranking/ranking.js';
import type { Target } from '../target/target.js';
import type { AcquisitionEvent, AcquisitionRequest, DownloadedFile } from './events.js';

/**
 * The folded state of one acquisition (the sole aggregate, D1). `evolve` is a pure, total fold
 * over the event history; it never fails and performs no I/O. Business intelligence lives in
 * `decide`, not here.
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

export interface AcquisitionState {
  readonly phase: AcquisitionPhase;
  readonly request?: AcquisitionRequest;
  readonly policies?: AcquisitionPolicies;
  readonly target?: Target;
  readonly working: readonly RankedCandidate[]; // untried, ranked candidates
  readonly current?: Candidate; // the candidate currently in flight
  readonly downloadedFiles: readonly DownloadedFile[];
  readonly rejected: readonly string[]; // candidate identity keys already rejected
  readonly searchRounds: number;
  readonly attempts: number; // download attempts made
  readonly location?: string; // library location once imported
}

export const initialState: AcquisitionState = {
  phase: 'Empty',
  working: [],
  downloadedFiles: [],
  rejected: [],
  searchRounds: 0,
  attempts: 0,
};

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

export function evolve(state: AcquisitionState, event: AcquisitionEvent): AcquisitionState {
  switch (event.type) {
    case 'AcquisitionRequested':
      return {
        ...initialState,
        phase: 'Pending',
        request: event.request,
        policies: event.policies,
      };
    case 'TargetResolved':
      return { ...state, phase: 'Searching', target: event.target };
    case 'MetadataResolutionFailed':
      return { ...state, phase: 'MetadataFailed' };
    case 'SearchRequested':
      return { ...state, phase: 'Searching' };
    case 'SearchCompleted':
      return { ...state, searchRounds: state.searchRounds + 1 };
    case 'CandidatesRanked':
      return { ...state, phase: 'Selecting', working: event.ranked };
    case 'CandidateSelected':
      return {
        ...state,
        phase: 'Downloading',
        current: event.candidate,
        working: state.working.filter(
          (ranked) =>
            candidateKey(ranked.candidate.identity) !== candidateKey(event.candidate.identity),
        ),
        downloadedFiles: [],
        attempts: state.attempts + 1,
      };
    case 'DownloadCompleted':
      return { ...state, phase: 'Validating', downloadedFiles: event.files };
    case 'DownloadFailed':
      return state; // the following CandidateRejected does the state work
    case 'CandidateRejected':
      return {
        ...state,
        phase: 'Selecting',
        current: undefined,
        rejected: [...state.rejected, candidateKey(event.candidate)],
      };
    case 'ValidationPassed':
      return { ...state, phase: 'Importing' };
    case 'ValidationFailed':
      return state; // the following CandidateRejected does the state work
    case 'Imported':
      return { ...state, location: event.location };
    case 'AcquisitionFulfilled':
      return { ...state, phase: 'Fulfilled', location: event.location };
    case 'AcquisitionExhausted':
      return { ...state, phase: 'Exhausted' };
    case 'ImportConflicted':
      return { ...state, phase: 'Conflicted', location: event.location };
    case 'AcquisitionCancelled':
      return { ...state, phase: 'Cancelled' };
  }
}

/** Fold a whole history into state — the replay path and a convenient test builder. */
export function foldEvents(events: readonly AcquisitionEvent[]): AcquisitionState {
  return events.reduce(evolve, initialState);
}

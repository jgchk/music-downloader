import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import type { Candidate } from '../candidate/candidate.js';
import { candidateKey } from '../candidate/candidate.js';
import { rankCandidates } from '../ranking/ranking.js';
import type { AcquisitionCommand, AcquisitionCommandType } from './commands.js';
import type { AcquisitionEvent } from './events.js';
import { isTerminal } from './state.js';
import type {
  AcquisitionPhase,
  AcquisitionState,
  DownloadingState,
  ValidatingState,
} from './state.js';

/**
 * `decide` is the brain (D2): a pure function that, given a command and the current state,
 * returns the events to append or a `DomainError`. All acquisition intelligence — ranking,
 * pick-next-or-exhaust, guarding stale/duplicate outcomes — lives here. `react` stays dumb.
 *
 * `DomainError` is reserved for illegal commands (protocol violations, D3). Business sadness
 * (a failed download, no candidates) is *not* an error — it flows as events on the happy path
 * of the retry loop.
 */
export type DomainError =
  | { readonly kind: 'AlreadyExists' }
  | {
      readonly kind: 'IllegalTransition';
      readonly command: AcquisitionCommandType;
      readonly phase: AcquisitionPhase;
    };

type Decision = Result<readonly AcquisitionEvent[], DomainError>;

function illegal(command: AcquisitionCommandType, state: AcquisitionState): DomainError {
  return { kind: 'IllegalTransition', command, phase: state.phase };
}

/**
 * Admit newly-found candidates, dropping the rejected-set and deduping by stable identity (D6).
 * D6 frames re-search as merging new results with the *untried* working set — but re-search fires
 * only once that set has emptied (see {@link selectNext}), so there are never untried candidates to
 * merge; the incoming round is the whole picture.
 */
function usableCandidates(
  incoming: readonly Candidate[],
  rejected: readonly string[],
): Candidate[] {
  const seen = new Set(rejected);
  const admitted: Candidate[] = [];
  for (const candidate of incoming) {
    const key = candidateKey(candidate.identity);
    if (seen.has(key)) continue;
    seen.add(key);
    admitted.push(candidate);
  }
  return admitted;
}

/**
 * After a rejection (or search) leaves the working set as-is, choose the next move: try the
 * next-best candidate, request a fresh bounded re-search, or give up (D6). `RetryPolicy` bounds
 * guarantee termination.
 */
function selectNext(state: DownloadingState | ValidatingState): AcquisitionEvent {
  const retry = state.policies.retry;
  if (state.attempts >= retry.maxTotalAttempts) return { type: 'AcquisitionExhausted' };
  const next = state.working[0];
  if (next !== undefined) return { type: 'CandidateSelected', candidate: next.candidate };
  if (state.searchRounds < retry.maxSearchRounds) {
    return { type: 'SearchRequested', round: state.searchRounds + 1 };
  }
  return { type: 'AcquisitionExhausted' };
}

/** After a candidate fails, reject it and decide the next move in one batch. */
function rejectAndAdvance(
  state: DownloadingState | ValidatingState,
  failure: AcquisitionEvent,
): readonly AcquisitionEvent[] {
  return [
    failure,
    { type: 'CandidateRejected', candidate: state.current.identity },
    selectNext(state),
  ];
}

export function decide(command: AcquisitionCommand, state: AcquisitionState): Decision {
  switch (command.type) {
    case 'SubmitAcquisition':
      if (state.phase !== 'Empty') return err({ kind: 'AlreadyExists' });
      return ok([
        { type: 'AcquisitionRequested', request: command.request, policies: command.policies },
      ]);

    case 'RecordTarget':
      if (isTerminal(state)) return ok([]);
      if (state.phase !== 'Pending') return err(illegal(command.type, state));
      return ok([{ type: 'TargetResolved', target: command.target }]);

    case 'RecordMetadataFailed':
      if (isTerminal(state)) return ok([]);
      if (state.phase !== 'Pending') return err(illegal(command.type, state));
      return ok([{ type: 'MetadataResolutionFailed' }]);

    case 'RecordSearchResults': {
      if (isTerminal(state)) return ok([]);
      if (state.phase !== 'Searching') return err(illegal(command.type, state));
      const usable = usableCandidates(command.candidates, state.rejected);
      const ranked = rankCandidates(
        usable,
        state.target,
        state.policies.quality,
        state.policies.match,
      );
      const events: AcquisitionEvent[] = [
        { type: 'SearchCompleted', round: state.searchRounds + 1, candidates: command.candidates },
        { type: 'CandidatesRanked', ranked },
      ];
      events.push(
        ranked.length > 0
          ? { type: 'CandidateSelected', candidate: ranked[0]!.candidate }
          : { type: 'AcquisitionExhausted' },
      );
      return ok(events);
    }

    case 'RecordDownloadCompleted':
      if (isTerminal(state)) return ok([]);
      if (state.phase !== 'Downloading') return err(illegal(command.type, state));
      return ok([
        { type: 'DownloadCompleted', candidate: state.current.identity, files: command.files },
      ]);

    case 'RecordDownloadFailed':
      if (isTerminal(state)) return ok([]);
      if (state.phase !== 'Downloading') return err(illegal(command.type, state));
      return ok(
        rejectAndAdvance(state, {
          type: 'DownloadFailed',
          candidate: state.current.identity,
          reason: command.reason,
        }),
      );

    case 'RecordValidationPassed':
      if (isTerminal(state)) return ok([]);
      if (state.phase !== 'Validating') return err(illegal(command.type, state));
      return ok([
        { type: 'ValidationPassed', candidate: state.current.identity, verdict: command.verdict },
      ]);

    case 'RecordValidationFailed':
      if (isTerminal(state)) return ok([]);
      if (state.phase !== 'Validating') return err(illegal(command.type, state));
      return ok(
        rejectAndAdvance(state, {
          type: 'ValidationFailed',
          candidate: state.current.identity,
          verdict: command.verdict,
        }),
      );

    case 'RecordImported':
      if (isTerminal(state)) return ok([]);
      if (state.phase !== 'Importing') return err(illegal(command.type, state));
      return ok([
        { type: 'Imported', candidate: state.current.identity, location: command.location },
        { type: 'AcquisitionFulfilled', location: command.location },
      ]);

    case 'RecordImportConflict':
      if (isTerminal(state)) return ok([]);
      if (state.phase !== 'Importing') return err(illegal(command.type, state));
      return ok([{ type: 'ImportConflicted', location: command.location }]);

    case 'CancelAcquisition':
      if (isTerminal(state)) return ok([]);
      return ok([{ type: 'AcquisitionCancelled' }]);
  }
}

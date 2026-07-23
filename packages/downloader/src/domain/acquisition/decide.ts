import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import type { Candidate } from '../candidate/candidate.js';
import { candidateKey, refersTo } from '../candidate/candidate.js';
import type { AcquisitionPolicies } from '../policy/policies.js';
import { rankCandidates } from '../ranking/ranking.js';
import type { RankedCandidate } from '../ranking/ranking.js';
import type { AcquisitionCommand, AcquisitionCommandType } from './commands.js';
import type { AcquisitionEvent, DownloadedFile } from './events.js';
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
    }
  // A SelectEdition naming a release that is not among the retained candidates: the menu is the
  // contract, so an off-menu choice is a protocol violation, not a resolvable request.
  | { readonly kind: 'UnknownEdition'; readonly releaseMbid: string };

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
 * The slice of state the ladder's next-move choice reads — carried by the in-flight phases and by
 * a revivable fulfilment's retained context alike.
 */
interface LadderContext {
  readonly policies: AcquisitionPolicies;
  readonly working: readonly RankedCandidate[];
  readonly attempts: number;
  readonly searchRounds: number;
}

/**
 * After a rejection (or search) leaves the working set as-is, choose the next move: try the
 * next-best candidate, request a fresh bounded re-search, or give up (D6). `RetryPolicy` bounds
 * guarantee termination.
 */
function selectNext(state: LadderContext): AcquisitionEvent {
  const retry = state.policies.retry;
  if (state.attempts >= retry.maxTotalAttempts) return { type: 'AcquisitionExhausted' };
  const next = state.working[0];
  if (next !== undefined) return { type: 'CandidateSelected', candidate: next.candidate };
  if (state.searchRounds < retry.maxSearchRounds) {
    return { type: 'SearchRequested', round: state.searchRounds + 1 };
  }
  return { type: 'AcquisitionExhausted' };
}

/**
 * The staged files a cleanup-triggering event must carry so cleanup targets the source-reported
 * location (design D3). Only `Validating`/`Importing` states hold them; from any other state
 * (e.g. a download that failed before staging) there is nothing staged to clean.
 */
function stagedFilesOf(state: AcquisitionState): readonly DownloadedFile[] {
  return 'downloadedFiles' in state ? state.downloadedFiles : [];
}

/**
 * After a candidate fails, reject it and decide the next move in one batch. `files` are the rejected
 * candidate's staged files to clean up (via `react`): the source-reported partial subset for a failed
 * download (the domain never saw them staged), or the folded `downloadedFiles` for a failed validation.
 */
function rejectAndAdvance(
  state: DownloadingState | ValidatingState,
  failure: AcquisitionEvent,
  files: readonly DownloadedFile[],
): readonly AcquisitionEvent[] {
  return [
    failure,
    { type: 'CandidateRejected', candidate: state.current.identity, files },
    selectNext(state),
  ];
}

/**
 * A download aborted by a cancellation has settled: reject the pending candidate so its staged files
 * are cleaned up (via `react`), leaving the acquisition cancelled. Fires exactly once — a later
 * duplicate settlement folds to no `pending` and is absorbed by the terminal-state tolerance above.
 */
function settleCancelled(
  pending: Candidate,
  files: readonly DownloadedFile[],
): readonly AcquisitionEvent[] {
  return [{ type: 'CandidateRejected', candidate: pending.identity, files }];
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

    case 'RecordManualSelectionRequested':
      if (isTerminal(state)) return ok([]);
      if (state.phase !== 'Pending') return err(illegal(command.type, state));
      // Manual selection exists only for release-group requests (its editions ARE albums, which is
      // what lets the resume hardcode an album resolution). A resolver reporting needsSelection for
      // any other request kind is out of protocol; degrading to the failure outcome keeps the
      // domain — not the adapter — the guard, and keeps the resume's assumption unforgeable.
      if (state.request.kind !== 'release-group') {
        return ok([{ type: 'MetadataResolutionFailed' }]);
      }
      // An empty menu is not a choice — it is the unresolved outcome wearing a costume. Guarding
      // here (not just in the adapter) keeps "AwaitingManualSelection has a non-empty menu" true
      // for every history decide can produce, so the pause can never be a dead end.
      if (command.candidates.length === 0) return ok([{ type: 'MetadataResolutionFailed' }]);
      return ok([{ type: 'ManualSelectionRequested', candidates: command.candidates }]);

    case 'SelectEdition':
      // A user command, not an effect result: a stale or out-of-state selection is *rejected* (the
      // caller must learn its choice did nothing), unlike Record* commands which absorb on terminal.
      if (state.phase !== 'AwaitingManualSelection') return err(illegal(command.type, state));
      if (!state.candidates.some((candidate) => candidate.releaseMbid === command.releaseMbid)) {
        return err({ kind: 'UnknownEdition', releaseMbid: command.releaseMbid });
      }
      return ok([{ type: 'EditionSelected', releaseMbid: command.releaseMbid }]);

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
      // The ladder decides even here: an empty round spends its round and re-searches while
      // budget remains — a dry result is not proof of absence (peers come and go).
      events.push(
        selectNext({
          policies: state.policies,
          working: ranked,
          attempts: state.attempts,
          searchRounds: state.searchRounds + 1,
        }),
      );
      return ok(events);
    }

    case 'RecordDownloadCompleted':
      if (state.phase === 'Cancelled' && state.pending !== undefined)
        return ok(settleCancelled(state.pending, command.files));
      if (isTerminal(state)) return ok([]);
      if (state.phase !== 'Downloading') return err(illegal(command.type, state));
      return ok([
        { type: 'DownloadCompleted', candidate: state.current.identity, files: command.files },
      ]);

    case 'RecordDownloadFailed':
      if (state.phase === 'Cancelled' && state.pending !== undefined)
        return ok(settleCancelled(state.pending, command.files ?? []));
      if (isTerminal(state)) return ok([]);
      if (state.phase !== 'Downloading') return err(illegal(command.type, state));
      return ok(
        rejectAndAdvance(
          state,
          {
            type: 'DownloadFailed',
            candidate: state.current.identity,
            reason: command.reason,
          },
          command.files ?? [],
        ),
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
        rejectAndAdvance(
          state,
          {
            type: 'ValidationFailed',
            candidate: state.current.identity,
            verdict: command.verdict,
          },
          stagedFilesOf(state),
        ),
      );

    case 'RecordImported':
      if (isTerminal(state)) return ok([]);
      if (state.phase !== 'Importing') return err(illegal(command.type, state));
      return ok([
        {
          type: 'Imported',
          candidate: state.current.identity,
          location: command.location,
          files: state.downloadedFiles,
        },
        // The fulfilment names its candidate so the folded state retains the resume context an
        // external verdict needs (fulfillment-external-verdict D3).
        {
          type: 'AcquisitionFulfilled',
          location: command.location,
          candidate: state.current.identity,
        },
      ]);

    case 'RecordImportConflict':
      if (isTerminal(state)) return ok([]);
      if (state.phase !== 'Importing') return err(illegal(command.type, state));
      return ok([
        { type: 'ImportConflicted', location: command.location, files: state.downloadedFiles },
      ]);

    case 'RecordExternalValidationFailed': {
      // Fulfilled is stable-but-defeasible (fulfillment-external-verdict D2): this one command may
      // revive it — the single narrow exception to terminal absorption, guarded right here. Every
      // other phase converges silently: absorbing terminals stay absorbed, a legacy fulfilment has
      // no retained candidate to judge, a mismatched reference is stale, and a redelivery after
      // the revival finds the acquisition already back in flight.
      if (state.phase !== 'Fulfilled') return ok([]);
      const resume = state.resume;
      if (resume === undefined || !refersTo(command.candidate, resume.candidate.identity)) {
        return ok([]);
      }
      // The exact reject-and-advance shape of every other rejection, spending the same budgets:
      // nothing is staged any more (the files were imported), so the rejection carries no files.
      return ok([
        {
          type: 'FulfillmentRejected',
          candidate: resume.candidate.identity,
          reasons: command.reasons,
        },
        { type: 'CandidateRejected', candidate: resume.candidate.identity, files: [] },
        selectNext({
          policies: resume.policies,
          working: resume.working,
          attempts: state.attempts,
          searchRounds: state.searchRounds,
        }),
      ]);
    }

    case 'CancelAcquisition':
      if (isTerminal(state)) return ok([]);
      return ok([{ type: 'AcquisitionCancelled', files: stagedFilesOf(state) }]);
  }
}

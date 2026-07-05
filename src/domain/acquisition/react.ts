import type { Candidate, CandidateIdentity } from '../candidate/candidate.js';
import type { DownloadPolicy, MatchPolicy } from '../policy/policies.js';
import type { Target } from '../target/target.js';
import type { AcquisitionEvent, AcquisitionRequest, DownloadedFile } from './events.js';
import type { AcquisitionState } from './state.js';

/**
 * `react` is the reflex (D2): a pure, trivial map from an event to zero or more `Effect`
 * *descriptions*. It makes no decisions and performs no I/O — the imperative shell interprets
 * each Effect by calling a port and feeds the result back through `decide` as a command.
 */
export type Effect =
  | { readonly type: 'ResolveMetadata'; readonly request: AcquisitionRequest }
  | { readonly type: 'Search'; readonly target: Target; readonly round: number }
  | { readonly type: 'Download'; readonly candidate: Candidate; readonly policy: DownloadPolicy }
  | {
      readonly type: 'Validate';
      readonly files: readonly DownloadedFile[];
      readonly target: Target;
      readonly matchPolicy: MatchPolicy;
    }
  | { readonly type: 'Import'; readonly files: readonly DownloadedFile[]; readonly target: Target }
  | { readonly type: 'Cleanup'; readonly candidate: CandidateIdentity };

/**
 * `state` is the aggregate's *current* folded state — NOT strictly the state right after `event`.
 * The reactor folds the whole stream before reacting (see `Reactor.process`), so when `decide`
 * co-emits `event` with a follow-on (e.g. `Imported`, always trailed by `AcquisitionFulfilled`),
 * `state` is already the *later* phase (`Fulfilled`), not `event`'s post-state (`Importing`). This
 * also holds under at-least-once redelivery: a re-reacted event sees whatever state the stream has
 * since reached. Two rules follow:
 *   1. A reaction that must fire for a non-final co-emitted event MUST key off the event's own
 *      payload, never the folded state (e.g. `Imported` → `Cleanup(event.candidate)`).
 *   2. A reaction that reads `state` narrows on its phase and falls through to no effects when the
 *      pairing does not match — consistent with `evolve`'s tolerant fold, and doubling as a guard
 *      that suppresses re-emitting an effect whose consequences the stream already records.
 */
export function react(event: AcquisitionEvent, state: AcquisitionState): readonly Effect[] {
  switch (event.type) {
    case 'AcquisitionRequested':
      return [{ type: 'ResolveMetadata', request: event.request }];
    case 'TargetResolved':
      return [{ type: 'Search', target: event.target, round: 1 }];
    case 'SearchRequested':
      return state.phase === 'Searching'
        ? [{ type: 'Search', target: state.target, round: event.round }]
        : [];
    case 'CandidateSelected':
      return state.phase === 'Downloading'
        ? [{ type: 'Download', candidate: event.candidate, policy: state.policies.download }]
        : [];
    case 'DownloadCompleted':
      return state.phase === 'Validating'
        ? [
            {
              type: 'Validate',
              files: event.files,
              target: state.target,
              matchPolicy: state.policies.match,
            },
          ]
        : [];
    case 'ValidationPassed':
      return state.phase === 'Importing'
        ? [{ type: 'Import', files: state.downloadedFiles, target: state.target }]
        : [];
    case 'CandidateRejected':
      // A rejected candidate's staged files must never reach the library (D13).
      return [{ type: 'Cleanup', candidate: event.candidate }];
    case 'Imported':
      // The imported candidate's now-empty staging directory is removed. Keyed off the event's own
      // candidate because the folded post-state is already Fulfilled (see the note above).
      return [{ type: 'Cleanup', candidate: event.candidate }];
    case 'ImportConflicted':
      // The downloaded release will never be imported (the location is occupied) — discard staging.
      return state.phase === 'Conflicted'
        ? [{ type: 'Cleanup', candidate: state.current.identity }]
        : [];
    case 'AcquisitionCancelled':
      // Discard staging only when the transfer had settled (the folded Cancelled state kept the
      // candidate); an in-flight download is left alone (no `current`) to avoid racing the source.
      return state.phase === 'Cancelled' && state.current !== undefined
        ? [{ type: 'Cleanup', candidate: state.current.identity }]
        : [];
    case 'MetadataResolutionFailed':
    case 'SearchCompleted':
    case 'CandidatesRanked':
    case 'DownloadFailed':
    case 'ValidationFailed':
    case 'AcquisitionFulfilled':
    case 'AcquisitionExhausted':
      return [];
  }
}

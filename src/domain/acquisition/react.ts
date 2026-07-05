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
  | { readonly type: 'Cleanup'; readonly candidate: CandidateIdentity }
  | { readonly type: 'AbortDownload'; readonly candidate: Candidate };

/**
 * `state` is the state *as of* `event`: the fold of the stream prefix up to and including it (the
 * reactor slices the stream before reacting — see `Reactor.process`). So `event`'s post-state is
 * exactly what a reaction reads, both for co-emitted batches (reacting to a non-final event sees its
 * own phase, not a batch successor's) and under at-least-once redelivery (a re-reacted event sees
 * the same state it saw at first delivery, regardless of how far the stream has since advanced).
 *
 * The phase narrowings below are TypeScript refinements over the `AcquisitionState` union; for a
 * well-formed history each guard's phase is implied by the event just folded. They also fall through
 * to no effects when the pairing does not match — consistent with `evolve`'s tolerant fold, which
 * ignores an event that does not fit the reached phase (possible only for a corrupted or externally
 * edited history). Re-firing under redelivery is safe by contract, not by suppression here: effects
 * are idempotent and their follow-on commands pass back through `decide`, which rejects stale
 * outcomes (see the reactor's checkpoint semantics and `docs/development/event-sourcing.md`).
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
      // candidate (event-carried data): `evolve` treats `Imported` as a state no-op, so the identity
      // lives on the event, not in the post-state.
      return [{ type: 'Cleanup', candidate: event.candidate }];
    case 'ImportConflicted':
      // The downloaded release will never be imported (the location is occupied) — discard staging.
      return state.phase === 'Conflicted'
        ? [{ type: 'Cleanup', candidate: state.current.identity }]
        : [];
    case 'AcquisitionCancelled':
      // A settled transfer (folded to `current`) is discarded straight away. A mid-download transfer
      // (folded to `pending`) is aborted at the source first; its staging is cleaned up later, when
      // the resulting settlement rejects the candidate. Once `pending` is cleared by that rejection,
      // a re-reacted cancellation emits nothing — the redelivery guard.
      if (state.phase !== 'Cancelled') return [];
      if (state.current !== undefined)
        return [{ type: 'Cleanup', candidate: state.current.identity }];
      if (state.pending !== undefined) return [{ type: 'AbortDownload', candidate: state.pending }];
      return [];
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

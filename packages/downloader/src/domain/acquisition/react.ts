import type { Candidate } from '../candidate/candidate.js';
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
  | { readonly type: 'Cleanup'; readonly files: readonly DownloadedFile[] }
  | { readonly type: 'AbortDownload'; readonly candidate: Candidate };

/**
 * `state` is the state *as of* `event`: the fold of the stream prefix up to and including it (the
 * reactor slices the stream before reacting — see the reactor's prefix-fold dispatch). So `event`'s post-state is
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
    case 'EditionSelected':
      // The resume: resolve exactly the chosen release, reusing the direct-by-release-id path — no
      // new "release id → target" logic exists for manual selection (manual-edition-selection D2).
      // `kind: 'musicbrainz'` is not a provider choice made here: `EditionSelected` carries a
      // release MBID, so the direct-by-release-id request is the only kind that can express it. A
      // second metadata provider would bring its own selection vocabulary (request kind + event),
      // not reuse this arm.
      // `targetType: 'album'` is domain-guaranteed: `decide` only pauses release-group requests
      // (whose type pins album), so an awaiting acquisition can never hold anything else — and a
      // chosen edition is an album release by definition.
      return [
        {
          type: 'ResolveMetadata',
          request: { kind: 'musicbrainz', mbid: event.releaseMbid, targetType: 'album' },
        },
      ];
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
      // A rejected candidate's staged files must never reach the library (D13). The files ride on
      // the event (stamped by `decide` at mint time), so cleanup targets slskd's reported location
      // rather than a path recomputed from identity (D3); legacy history without them upcasts to none.
      return [{ type: 'Cleanup', files: event.files ?? [] }];
    case 'Imported':
      // The imported candidate's now-emptied staging directory is pruned. Keyed off the event's own
      // carried files: `evolve` treats `Imported` as a state no-op, so the files live on the event,
      // not in the post-state (D3).
      return [{ type: 'Cleanup', files: event.files ?? [] }];
    case 'ImportConflicted':
      // The downloaded release will never be imported (the location is occupied) — discard staging.
      return state.phase === 'Conflicted' ? [{ type: 'Cleanup', files: event.files ?? [] }] : [];
    case 'AcquisitionCancelled':
      // A settled transfer (staging `settled`) is discarded straight away, from the files carried
      // on the event (D3). A mid-download transfer (staging `in-flight`) is aborted at the source
      // first; its staging is cleaned up later, when the resulting settlement rejects the candidate.
      // Once that rejection clears the staging to `none`, a re-reacted cancellation emits nothing.
      if (state.phase !== 'Cancelled') return [];
      if (state.staging.kind === 'settled') return [{ type: 'Cleanup', files: event.files ?? [] }];
      if (state.staging.kind === 'in-flight')
        return [{ type: 'AbortDownload', candidate: state.staging.pending }];
      return [];
    case 'MetadataResolutionFailed':
    // The pause itself: an acquisition awaiting a human's edition choice does nothing — no search,
    // no download, no import — until a SelectEdition or a cancellation moves it on.
    case 'ManualSelectionRequested':
    case 'SearchCompleted':
    case 'CandidatesRanked':
    case 'DownloadFailed':
    case 'ValidationFailed':
    case 'AcquisitionFulfilled':
    // A revival needs no effect of its own: the co-emitted CandidateRejected drives cleanup, and
    // the batch's CandidateSelected/SearchRequested drive the revival's work.
    case 'FulfillmentRejected':
    case 'AcquisitionExhausted':
      return [];
  }
}

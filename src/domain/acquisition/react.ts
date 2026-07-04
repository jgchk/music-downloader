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

/** `state` is the state *after* the event has been applied. */
export function react(event: AcquisitionEvent, state: AcquisitionState): readonly Effect[] {
  switch (event.type) {
    case 'AcquisitionRequested':
      return [{ type: 'ResolveMetadata', request: event.request }];
    case 'TargetResolved':
      return [{ type: 'Search', target: event.target, round: 1 }];
    case 'SearchRequested':
      return [{ type: 'Search', target: state.target!, round: event.round }];
    case 'CandidateSelected':
      return [{ type: 'Download', candidate: event.candidate, policy: state.policies!.download }];
    case 'DownloadCompleted':
      return [
        {
          type: 'Validate',
          files: event.files,
          target: state.target!,
          matchPolicy: state.policies!.match,
        },
      ];
    case 'ValidationPassed':
      return [{ type: 'Import', files: state.downloadedFiles, target: state.target! }];
    case 'CandidateRejected':
      // A rejected candidate's staged files must never reach the library (D13).
      return [{ type: 'Cleanup', candidate: event.candidate }];
    case 'MetadataResolutionFailed':
    case 'SearchCompleted':
    case 'CandidatesRanked':
    case 'DownloadFailed':
    case 'ValidationFailed':
    case 'Imported':
    case 'AcquisitionFulfilled':
    case 'AcquisitionExhausted':
    case 'ImportConflicted':
    case 'AcquisitionCancelled':
      return [];
  }
}

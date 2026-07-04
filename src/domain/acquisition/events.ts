import type { Candidate, CandidateIdentity } from '../candidate/candidate.js';
import type { AcquisitionPolicies } from '../policy/policies.js';
import type { RankedCandidate } from '../ranking/ranking.js';
import type { Target, TargetType } from '../target/target.js';
import type { ValidationVerdict } from '../validation/verdict.js';

/**
 * Domain events — the facts that make up an acquisition's history (event-sourcing). They read as
 * a business narrative, not telemetry: only business-meaningful transitions are events. High-
 * frequency transfer progress is deliberately kept OFF the stream (D1) as an ephemeral read model.
 */

/** What the caller asked for: a MusicBrainz id, or a structured descriptor to resolve (D12). */
export type AcquisitionRequest =
  | { readonly kind: 'musicbrainz'; readonly mbid: string; readonly targetType: TargetType }
  | {
      readonly kind: 'descriptor';
      readonly targetType: TargetType;
      readonly artist: string;
      readonly title: string;
      readonly album?: string;
    };

/** Source-agnostic download failure reasons, translated from Soulseek specifics by the adapter (D10). */
export type DownloadFailureReason =
  | 'PeerUnavailable'
  | 'Stalled'
  | 'QueueTimeout'
  | 'TransferError'
  | 'FileUnavailable'
  | 'Cancelled';

export interface DownloadedFile {
  readonly path: string; // absolute path in the staging area
  readonly name: string; // file name within the candidate
}

export type AcquisitionEvent =
  | {
      readonly type: 'AcquisitionRequested';
      readonly request: AcquisitionRequest;
      readonly policies: AcquisitionPolicies;
    }
  | { readonly type: 'TargetResolved'; readonly target: Target }
  | { readonly type: 'MetadataResolutionFailed' }
  | { readonly type: 'SearchRequested'; readonly round: number }
  | {
      readonly type: 'SearchCompleted';
      readonly round: number;
      readonly candidates: readonly Candidate[];
    }
  | { readonly type: 'CandidatesRanked'; readonly ranked: readonly RankedCandidate[] }
  | { readonly type: 'CandidateSelected'; readonly candidate: Candidate }
  | {
      readonly type: 'DownloadCompleted';
      readonly candidate: CandidateIdentity;
      readonly files: readonly DownloadedFile[];
    }
  | {
      readonly type: 'DownloadFailed';
      readonly candidate: CandidateIdentity;
      readonly reason: DownloadFailureReason;
    }
  | { readonly type: 'CandidateRejected'; readonly candidate: CandidateIdentity }
  | {
      readonly type: 'ValidationPassed';
      readonly candidate: CandidateIdentity;
      readonly verdict: ValidationVerdict;
    }
  | {
      readonly type: 'ValidationFailed';
      readonly candidate: CandidateIdentity;
      readonly verdict: ValidationVerdict;
    }
  | { readonly type: 'Imported'; readonly candidate: CandidateIdentity; readonly location: string }
  | { readonly type: 'AcquisitionFulfilled'; readonly location: string }
  | { readonly type: 'AcquisitionExhausted' }
  | { readonly type: 'ImportConflicted'; readonly location: string }
  | { readonly type: 'AcquisitionCancelled' };

export type AcquisitionEventType = AcquisitionEvent['type'];

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

/**
 * What the caller asked for: a MusicBrainz release/recording id, a MusicBrainz release-*group* id
 * (an album identity, resolved to a representative official edition), or a structured descriptor to
 * resolve (D12).
 */
export type AcquisitionRequest =
  | { readonly kind: 'musicbrainz'; readonly mbid: string; readonly targetType: TargetType }
  | { readonly kind: 'release-group'; readonly mbid: string; readonly targetType: 'album' }
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
  | {
      readonly type: 'CandidateRejected';
      readonly candidate: CandidateIdentity;
      // The rejected candidate's staged files, stamped at mint time so staging-cleanup targets the
      // source-reported location (design D3). Optional/additive: legacy history upcasts to none.
      readonly files?: readonly DownloadedFile[];
    }
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
  | {
      readonly type: 'Imported';
      readonly candidate: CandidateIdentity;
      readonly location: string;
      readonly files?: readonly DownloadedFile[]; // staged files to clean after the move (D3)
    }
  | {
      readonly type: 'AcquisitionFulfilled';
      readonly location: string;
      // The fulfilled candidate, stamped at mint time so the folded Fulfilled state can retain it
      // as the stale-guard for external verdicts (fulfillment-external-verdict D3). Optional/
      // additive: a legacy fulfilment names no candidate and cannot be revived.
      readonly candidate?: CandidateIdentity;
    }
  | {
      // Validation that ran *outside* the system judged the delivered outcome unacceptable:
      // rejects the fulfilled candidate (distinct from ValidationFailed, which rejects an
      // in-flight candidate during Validating) and re-enters the retry ladder.
      readonly type: 'FulfillmentRejected';
      readonly candidate: CandidateIdentity;
      readonly reasons: readonly string[];
    }
  | { readonly type: 'AcquisitionExhausted' }
  | {
      readonly type: 'ImportConflicted';
      readonly location: string;
      readonly files?: readonly DownloadedFile[]; // staged files to discard, never imported (D3)
    }
  | { readonly type: 'AcquisitionCancelled'; readonly files?: readonly DownloadedFile[] };

export type AcquisitionEventType = AcquisitionEvent['type'];

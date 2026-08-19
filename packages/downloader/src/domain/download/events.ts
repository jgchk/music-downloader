import type { Candidate, CandidateIdentity } from '../candidate/candidate.js';
import type { DownloadPolicies } from '../policy/policies.js';
import type { RankedCandidate } from '../ranking/ranking.js';
import type { Mbid } from '../shared/mbid.js';
import type { Target, TargetType } from '../target/target.js';
import type { ValidationVerdict } from '../validation/verdict.js';

/**
 * Domain events — the facts that make up a download's history (event-sourcing). They read as
 * a business narrative, not telemetry: only business-meaningful transitions are events. High-
 * frequency transfer progress is deliberately kept OFF the stream (D1) as an ephemeral read model.
 */

/**
 * What the caller asked for: a MusicBrainz release/recording id, a MusicBrainz release-*group* id
 * (an album identity, resolved to a representative official edition — or paused for manual edition
 * selection when none is official), or a structured descriptor to resolve (D12).
 */
export type DownloadRequest =
  | { readonly kind: 'musicbrainz'; readonly mbid: Mbid; readonly targetType: TargetType }
  | { readonly kind: 'release-group'; readonly mbid: Mbid; readonly targetType: 'album' }
  | {
      readonly kind: 'descriptor';
      readonly targetType: TargetType;
      readonly artist: string;
      readonly title: string;
      readonly album?: string;
    };

/** Source-agnostic download failure reasons, translated from Soulseek specifics by the adapter (D10). */
export type TryFailureReason =
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

/**
 * One edition of a release group offered for manual selection — a lightweight presentation value,
 * not a {@link Target}, since presenting an edition needs no track manifest. Carried on the
 * `ManualSelectionRequested` event so the retained candidates are part of the download's
 * history. Every field is optional: MusicBrainz data is sparse, and a missing field degrades
 * presentation, never the pause itself. An unknown track count is absent (the mapping sums
 * per-medium counts; a release with no usable media has no count to report). Legacy v1 history
 * stored an unknown count as the sentinel `0` — the read-side upcaster folds that `0` to absent.
 */
export interface EditionCandidate {
  readonly releaseMbid: Mbid;
  readonly title?: string;
  readonly date?: string;
  readonly country?: string;
  readonly format?: string;
  readonly trackCount?: number;
}

export type DownloadEvent =
  | {
      readonly type: 'DownloadRequested';
      readonly request: DownloadRequest;
      readonly policies: DownloadPolicies;
    }
  | { readonly type: 'TargetResolved'; readonly target: Target }
  | { readonly type: 'MetadataResolutionFailed' }
  | {
      // A release-group request found editions but none official: resolution cannot pick, so the
      // download pauses with the candidates for a human to choose (manual-edition-selection).
      readonly type: 'ManualSelectionRequested';
      readonly candidates: readonly EditionCandidate[];
    }
  | {
      // The human chose: resolve exactly this release, identical to a direct-by-release-id request.
      readonly type: 'EditionSelected';
      readonly releaseMbid: Mbid;
    }
  | { readonly type: 'SearchRequested'; readonly round: number }
  | {
      readonly type: 'SearchCompleted';
      readonly round: number;
      readonly candidates: readonly Candidate[];
    }
  | { readonly type: 'CandidatesRanked'; readonly ranked: readonly RankedCandidate[] }
  | { readonly type: 'CandidateSelected'; readonly candidate: Candidate }
  | {
      // The source accepted the enqueue: the transfer is in flight. Recorded so the lifecycle has
      // an honest downloading phase — a transferring download is distinguishable from one that
      // merely selected a candidate (nonblocking-download-observation).
      readonly type: 'TryStarted';
      readonly candidate: CandidateIdentity;
    }
  | {
      readonly type: 'TryCompleted';
      readonly candidate: CandidateIdentity;
      readonly files: readonly DownloadedFile[];
    }
  | {
      readonly type: 'TryFailed';
      readonly candidate: CandidateIdentity;
      readonly reason: TryFailureReason;
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
      readonly type: 'DownloadFulfilled';
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
  | { readonly type: 'DownloadExhausted' }
  | {
      readonly type: 'ImportConflicted';
      readonly location: string;
      readonly files?: readonly DownloadedFile[]; // staged files to discard, never imported (D3)
    }
  | { readonly type: 'DownloadCancelled'; readonly files?: readonly DownloadedFile[] };

export type DownloadEventType = DownloadEvent['type'];

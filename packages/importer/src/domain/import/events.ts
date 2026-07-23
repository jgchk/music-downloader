import type { AcquisitionId } from '../shared/acquisition-id.js';
import type { Distance } from '../shared/distance.js';
import type { NonEmptyReadonlyArray } from '../shared/non-empty-array.js';
import type { PositiveInt } from '../shared/positive-int.js';

/**
 * Domain events — the facts that make up an import's history (event-sourcing). They narrate the
 * import *process* only: beets' library database remains the system of record for the library
 * itself, and nothing here describes library state beyond what beets reported back.
 */

/** Optional hints supplied at submission: they pin the candidate search but never the verdict. */
export interface ImportHints {
  readonly mbReleaseId?: string;
  readonly artist?: string;
  readonly album?: string;
}

/** The policy stamped onto the request: distance at or below the threshold auto-applies. */
export interface ImportPolicy {
  readonly autoApplyThreshold: Distance;
}

/**
 * The delivered candidate's identity as the sender published it — which peer's copy was
 * downloaded. Retained so a later release verdict can echo the identity the sender's stale-guard
 * compares against; `sizeBytes` is corroborating detail the sender may omit.
 */
export interface DeliveredCandidate {
  readonly username: string;
  readonly path: string;
  readonly sizeBytes?: number;
}

/**
 * Provenance of an event-driven submission: the sender-side acquisition that deposited the
 * directory. Recorded on `ImportRequested` so redelivered acquisition events converge durably
 * (the projection indexes it across restarts) instead of relying on in-memory dedupe. The
 * delivered candidate rides along when the event carried one — without it the import simply
 * cannot emit a release verdict.
 */
export interface ImportSource {
  readonly acquisitionId: AcquisitionId;
  readonly candidate?: DeliveredCandidate;
}

/**
 * A candidate's identity as beets 2.x models it: the `(data_source, album_id)` pair. Metadata
 * sources are pluggable, so a bare MusicBrainz id is ambiguous — the pair is the stable key that
 * `apply` re-resolves deterministically.
 */
export interface CandidateReference {
  readonly dataSource: string;
  readonly albumId: string;
}

export function candidateReferenceKey(reference: CandidateReference): string {
  return `${reference.dataSource}:${reference.albumId}`;
}

/** One component of beets' distance breakdown (e.g. `tracks`, `missing_tracks`, `year`). */
export interface CandidatePenalty {
  readonly name: string;
  readonly amount: Distance;
}

/** A mapped file's current embedded tags — the before-side of a per-track retag diff. */
export interface TrackCurrentTags {
  readonly title: string;
  readonly artist: string;
  readonly track: number;
  /** Duration in seconds; absent when the file's duration could not be read (never a false 0). */
  readonly length?: number;
}

/**
 * One entry of the item-to-track mapping beets computed for a candidate. `title`/`index` are the
 * candidate's *proposed* values; `current`/`distance` (additive, optional — absent on events
 * recorded before diff evidence was captured) carry the file's current tags and how far this
 * mapped pair is from a clean match.
 */
export interface TrackMapping {
  readonly path: string;
  readonly title: string;
  readonly index: number;
  readonly current?: TrackCurrentTags;
  /** How far this mapped pair is from a clean match — the same branded {@link Distance} as
   * everywhere else (the beets ACL proves the schema's [0, 1] bound before branding it). */
  readonly distance?: Distance;
}

/** A downloaded file the candidate placed against no track (the `unmatched_tracks` penalty). */
export interface UnmatchedFile {
  readonly path: string;
  readonly title: string;
  readonly track: number;
}

/** A candidate track no downloaded file supplied (the `missing_tracks` penalty). */
export interface MissingTrack {
  readonly title: string;
  readonly index: number;
}

/** The candidate's album-level fields, for the album-field diff against the files' current tags. */
export interface CandidateAlbumFields {
  readonly year: number;
  readonly media: string;
  readonly label: string;
  readonly catalognum: string;
  readonly country: string;
  readonly albumDisambig: string;
}

/**
 * A proposed candidate: identity, headline naming, and the evidence behind its distance. The diff
 * evidence is additive and optional — a candidate on a `CandidatesProposed` recorded before this
 * capability carries none of it: the per-track before/after rides on `tracks[].current`/`distance`
 * (see {@link TrackMapping}), and `extraItems`/`missingTracks`/`albumFields` are the new top-level fields.
 */
export interface ProposedCandidate {
  readonly ref: CandidateReference;
  readonly artist: string;
  readonly album: string;
  readonly distance: Distance;
  readonly penalties: readonly CandidatePenalty[];
  readonly tracks: readonly TrackMapping[];
  readonly extraItems?: readonly UnmatchedFile[];
  readonly missingTracks?: readonly MissingTrack[];
  readonly albumFields?: CandidateAlbumFields;
}

/** An album already in the library that a candidate would duplicate. */
export interface DuplicateIncumbent {
  readonly artist: string;
  readonly album: string;
  readonly path: string;
}

/** A post-move enrichment step that failed during apply (D7: applied-with-remediation). */
export interface ApplyFailure {
  readonly stage: string;
  readonly message: string;
}

/** Why an import waits in review, with the kind-specific context a human needs to decide. */
export type ReviewCause =
  | {
      readonly kind: 'match-review';
      readonly hinted: boolean;
      /**
       * The release id pinned/hinted for this proposal (mb release id or a supplied search id),
       * when one was in play. Additive/optional — absent on pre-change events and when no id was
       * hinted. Lets a reader tell "the pinned release wasn't the best match" (best candidate's
       * album id differs) from "the pinned release matched, but weakly" (they agree).
       *
       * For events written from this version `hinted === (hintedReleaseId !== undefined)` (the
       * decider derives one from the other); `hinted` is authoritative and retained only so
       * pre-change events, which have no id, still read as hinted.
       */
      readonly hintedReleaseId?: string;
      /**
       * The best (lowest-distance) candidate that fell to review. Required: the decider reaches
       * `match-review` only for a non-empty candidate list (the empty case routes to `no-match`
       * first), so it has always populated `best` — every stored `match-review` event carries it,
       * and no legacy history lacks it. (The wire DTO keeps `best` optional; that is a separate,
       * additive serialization altitude.)
       */
      readonly best: CandidateReference;
    }
  | { readonly kind: 'no-match' }
  | {
      readonly kind: 'duplicate-review';
      readonly incumbents: NonEmptyReadonlyArray<DuplicateIncumbent>;
    }
  | { readonly kind: 'remediation-review'; readonly failures: NonEmptyReadonlyArray<ApplyFailure> };

export type ReviewKind = ReviewCause['kind'];

/** Per-track fields of a manual tag payload (autotag bypassed; beets still fires plugins). */
export interface ManualTrackTags {
  readonly path: string;
  readonly title: string;
  readonly artist?: string;
  readonly trackNumber: PositiveInt;
  readonly discNumber?: PositiveInt;
}

/** A full manual tag payload with an explicit track mapping. */
export interface ManualTags {
  readonly albumArtist: string;
  readonly album: string;
  readonly year?: number;
  readonly tracks: NonEmptyReadonlyArray<ManualTrackTags>;
}

/** How to settle a duplicate: replace the incumbent, or keep both. */
export type DuplicateResolution = 'replace' | 'keep-both';

/** The explicit verbs a review resolves through. */
export type Resolution =
  | {
      readonly kind: 'apply-candidate';
      readonly ref: CandidateReference;
      readonly duplicateAction?: DuplicateResolution;
    }
  | { readonly kind: 'supply-id'; readonly mbReleaseId: string }
  | { readonly kind: 'refresh-candidates' }
  | { readonly kind: 'manual-tags'; readonly tags: ManualTags }
  | { readonly kind: 'import-as-is' }
  | { readonly kind: 'reject'; readonly reason?: string }
  | { readonly kind: 'reject-and-retry-download'; readonly reasons?: readonly string[] }
  | { readonly kind: 'accept' }
  | { readonly kind: 'retry-enrichment' };

export type ResolutionKind = Resolution['kind'];

/** How beets is asked to perform an apply. */
export type ApplyMode =
  | {
      readonly kind: 'candidate';
      readonly ref: CandidateReference;
      readonly duplicateAction?: DuplicateResolution;
    }
  | { readonly kind: 'as-is' }
  | { readonly kind: 'manual-tags'; readonly tags: ManualTags };

export type ImportEvent =
  | {
      readonly type: 'ImportRequested';
      readonly directory: string;
      readonly hints?: ImportHints;
      readonly policy: ImportPolicy;
      readonly source?: ImportSource;
    }
  | {
      readonly type: 'CandidatesProposed';
      readonly candidates: readonly ProposedCandidate[];
      readonly duplicates: readonly DuplicateIncumbent[];
      readonly pinnedId?: string;
    }
  | {
      readonly type: 'AutoApplySelected';
      readonly ref: CandidateReference;
      readonly distance: Distance;
    }
  | { readonly type: 'ReviewRequired'; readonly cause: ReviewCause }
  | { readonly type: 'ReviewResolved'; readonly resolution: Resolution }
  | { readonly type: 'ImportApplied'; readonly location: string }
  | { readonly type: 'RemediationRequired'; readonly failures: NonEmptyReadonlyArray<ApplyFailure> }
  | { readonly type: 'ImportRejected'; readonly reason: string; readonly filesDeleted: boolean }
  | {
      /**
       * The delivered release failed external validation (reject-and-retry-download): the fact the
       * outbound publisher ships to the sender so it can revive the acquisition. Minted in the same
       * decision as the rejection's `ReviewResolved`; drives no effect and no state change.
       */
      readonly type: 'ReleaseVerdictRecorded';
      readonly acquisitionId: AcquisitionId;
      readonly candidate: DeliveredCandidate;
      readonly reasons: readonly string[];
    };

export type ImportEventType = ImportEvent['type'];

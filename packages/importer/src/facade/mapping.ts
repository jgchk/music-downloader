import type {
  ImportHints,
  ManualTags,
  ProposedCandidate,
  Resolution,
} from '../domain/import/events.js';
import type { OpenReview } from '../domain/import/import.js';
import { assertNonEmpty } from '../domain/shared/non-empty-array.js';
import { toPositiveInt } from '../domain/shared/positive-int.js';
import type {
  ImportStatusView,
  PendingReviewView,
} from '../application/projections/read-models.js';
import type {
  ImportStatusResponseDto,
  PendingReviewDto,
  ResolveReviewRequestDto,
  ReviewDto,
  SubmitImportRequestDto,
} from './schemas.js';

/**
 * The anti-corruption mapping between the wire DTOs and the domain/application vocabulary. Both
 * inbound directions (submission hints, resolution verbs) and outbound views flow through here,
 * so the interfaces never touch domain types directly and the wire shapes can evolve additively
 * on their own.
 */

export function hintsToDomain(dto: SubmitImportRequestDto): ImportHints | undefined {
  const hints = dto.hints;
  if (hints === undefined) return undefined;
  return { mbReleaseId: hints.mbReleaseId, artist: hints.artist, album: hints.album };
}

/** Lift a wire manual-tags payload into the domain shape: `.min(1)` tracks and `.int().positive()`
 * ordinals are proven by the schema, so they are branded here rather than re-validated. */
function manualTagsToDomain(
  tags: Extract<ResolveReviewRequestDto, { verb: 'manual-tags' }>['tags'],
): ManualTags {
  const tracks = tags.tracks.map((track) => ({
    path: track.path,
    title: track.title,
    artist: track.artist,
    trackNumber: toPositiveInt(track.trackNumber),
    discNumber: track.discNumber === undefined ? undefined : toPositiveInt(track.discNumber),
  }));
  return {
    albumArtist: tags.albumArtist,
    album: tags.album,
    year: tags.year,
    tracks: assertNonEmpty(tracks),
  };
}

export function resolutionToDomain(dto: ResolveReviewRequestDto): Resolution {
  switch (dto.verb) {
    case 'apply-candidate': {
      return {
        kind: 'apply-candidate',
        ref: { dataSource: dto.candidate.dataSource, albumId: dto.candidate.albumId },
        duplicateAction: dto.duplicateAction,
      };
    }
    case 'supply-id': {
      return { kind: 'supply-id', mbReleaseId: dto.mbReleaseId };
    }
    case 'refresh-candidates': {
      return { kind: 'refresh-candidates' };
    }
    case 'manual-tags': {
      return { kind: 'manual-tags', tags: manualTagsToDomain(dto.tags) };
    }
    case 'import-as-is': {
      return { kind: 'import-as-is' };
    }
    case 'reject': {
      return { kind: 'reject', reason: dto.reason };
    }
    case 'reject-unusable-delivery': {
      return { kind: 'reject-unusable-delivery', reasons: dto.reasons };
    }
    case 'accept': {
      return { kind: 'accept' };
    }
    case 'retry-enrichment': {
      return { kind: 'retry-enrichment' };
    }
  }
}

function candidateToDto(candidate: ProposedCandidate) {
  return {
    ref: { dataSource: candidate.ref.dataSource, albumId: candidate.ref.albumId },
    artist: candidate.artist,
    album: candidate.album,
    distance: candidate.distance,
    penalties: [...candidate.penalties],
    // The domain shapes match the DTO shapes exactly; copy the arrays, preserving absent (legacy)
    // fields as `undefined` so a pre-change review projects to today's score-only view.
    tracks: candidate.tracks.map((track) => ({ ...track })),
    extraItems: candidate.extraItems === undefined ? undefined : [...candidate.extraItems],
    missingTracks: candidate.missingTracks === undefined ? undefined : [...candidate.missingTracks],
    albumFields: candidate.albumFields === undefined ? undefined : { ...candidate.albumFields },
  };
}

export function reviewToDto(review: OpenReview): ReviewDto {
  const cause = review.cause;
  switch (cause.kind) {
    case 'match-review': {
      return {
        kind: 'match-review',
        hinted: cause.hinted,
        hintedReleaseId: cause.hintedReleaseId,
        // `best` is required in the domain; the wire DTO keeps it optional (a tolerant, additive
        // serialization altitude), but the mapping now always carries the present candidate.
        best: { ...cause.best },
        candidates: review.candidates.map((item) => candidateToDto(item)),
      };
    }
    case 'no-match': {
      return { kind: 'no-match' };
    }
    case 'duplicate-review': {
      return {
        kind: 'duplicate-review',
        incumbents: [...cause.incumbents],
        candidates: review.candidates.map((item) => candidateToDto(item)),
      };
    }
    case 'remediation-review': {
      return { kind: 'remediation-review', failures: [...cause.failures] };
    }
  }
}

export function statusViewToDto(view: ImportStatusView): ImportStatusResponseDto {
  return {
    importId: view.importId,
    acquisitionId: view.acquisitionId,
    path: view.directory,
    status: view.phase,
    location: view.location,
    review: view.openReview === undefined ? undefined : reviewToDto(view.openReview),
    rejection: view.rejection === undefined ? undefined : { ...view.rejection },
    stalled: view.stalled,
    history: view.history.map(
      (entry) => ({ ...entry }) as ImportStatusResponseDto['history'][number],
    ),
  };
}

export function pendingReviewToDto(view: PendingReviewView): PendingReviewDto {
  return {
    importId: view.importId,
    path: view.directory,
    review: reviewToDto(view.review),
  };
}

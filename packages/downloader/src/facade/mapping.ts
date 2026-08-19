import { Result, ok } from 'neverthrow';
import type { DownloadRequest } from '../domain/download/events.js';
import { parseMbid } from '../domain/shared/mbid.js';
import type { InvalidMbid } from '../domain/shared/mbid.js';
import type { DownloadPolicies } from '../domain/policy/policies.js';
import {
  DEFAULT_DOWNLOAD_POLICY,
  DEFAULT_MATCH_POLICY,
  DEFAULT_RETRY_POLICY,
  createDownloadPolicy,
  createMatchPolicy,
  createRetryPolicy,
} from '../domain/policy/policies.js';
import { DEFAULT_QUALITY_POLICY, createQualityPolicy } from '../domain/policy/quality-policy.js';
import type { TransferProgress } from '../application/ports/outbound-ports.js';
import type {
  DownloadStatusView,
  StatusHistoryEntry,
} from '../application/projections/read-models.js';
import type {
  AcquisitionRequestDto,
  AcquisitionStatusResponseDto,
  ProgressResponseDto,
  RequestedTargetEchoDto,
  SubmitAcquisitionRequestDto,
} from './schemas.js';

/**
 * The inbound/outbound anti-corruption boundary (D12): validated wire DTOs are mapped to domain
 * inputs and read-model views are mapped back to versioned DTOs, so the domain can evolve without
 * breaking the wire. Policies are resolved by folding the (all-optional) request policy fields over
 * the domain defaults through the domain smart constructors, so an inconsistent policy is rejected.
 */

type HistoryDto = AcquisitionStatusResponseDto['history'][number];

export function requestToDomain(
  dto: AcquisitionRequestDto,
): Result<DownloadRequest, InvalidMbid> {
  // The wire request mirrors the domain request today, but its id crosses the anti-corruption
  // boundary here: parse it once into an Mbid so the domain only ever holds well-formed ids.
  if (dto.kind === 'descriptor') return ok(dto);
  return parseMbid(dto.mbid).map((mbid) => ({ ...dto, mbid }));
}

export function resolvePolicies(
  dto: SubmitAcquisitionRequestDto,
): Result<DownloadPolicies, 'InvalidPolicy'> {
  const quality = createQualityPolicy(
    dto.qualityPolicy?.order ?? DEFAULT_QUALITY_POLICY.order,
    dto.qualityPolicy?.floor ?? DEFAULT_QUALITY_POLICY.floor,
  );
  const match = createMatchPolicy(dto.matchPolicy?.threshold ?? DEFAULT_MATCH_POLICY.threshold);
  const retry = createRetryPolicy({
    maxSearchRounds: dto.retryPolicy?.maxSearchRounds ?? DEFAULT_RETRY_POLICY.maxSearchRounds,
    maxTotalAttempts: dto.retryPolicy?.maxTotalAttempts ?? DEFAULT_RETRY_POLICY.maxTotalAttempts,
    timeBudgetMs: dto.retryPolicy?.timeBudgetMs ?? DEFAULT_RETRY_POLICY.timeBudgetMs,
  });
  const download = createDownloadPolicy({
    stallTimeoutMs: dto.downloadPolicy?.stallTimeoutMs ?? DEFAULT_DOWNLOAD_POLICY.stallTimeoutMs,
    maxQueueWaitMs: dto.downloadPolicy?.maxQueueWaitMs ?? DEFAULT_DOWNLOAD_POLICY.maxQueueWaitMs,
  });
  return Result.combine([quality, match, retry, download])
    .map(([q, m, r, d]) => ({ quality: q, match: m, retry: r, download: d }))
    .mapErr(() => 'InvalidPolicy' as const);
}

/**
 * The request echoed onto the wire as an explicit field projection — never a spread, so a future
 * domain-only field on `DownloadRequest` cannot leak into a response (the anti-corruption copy
 * is real). The domain's branded mbid decays to its string here.
 */
function requestToWire(request: DownloadRequest): RequestedTargetEchoDto {
  switch (request.kind) {
    case 'musicbrainz': {
      return { kind: 'musicbrainz', mbid: request.mbid, targetType: request.targetType };
    }
    case 'release-group': {
      return { kind: 'release-group', mbid: request.mbid, targetType: request.targetType };
    }
    case 'descriptor': {
      return {
        kind: 'descriptor',
        targetType: request.targetType,
        artist: request.artist,
        title: request.title,
        album: request.album,
      };
    }
  }
}

function historyEntryToDto(entry: StatusHistoryEntry): HistoryDto {
  const at = entry.at;
  switch (entry.kind) {
    case 'requested': {
      return { kind: 'requested', at, request: requestToWire(entry.request) };
    }
    case 'resolved': {
      return { kind: 'resolved', at, artist: entry.artist, title: entry.title, year: entry.year };
    }
    case 'search-started': {
      return { kind: 'search-started', at, round: entry.round };
    }
    case 'fulfilled': {
      return { kind: 'fulfilled', at, location: entry.location };
    }
    case 'exhausted': {
      return { kind: 'exhausted', at };
    }
    case 'conflicted': {
      return { kind: 'conflicted', at, location: entry.location };
    }
    case 'metadata-failed': {
      return { kind: 'metadata-failed', at };
    }
    case 'cancelled': {
      return { kind: 'cancelled', at };
    }
    case 'selected': {
      return { kind: 'selected', at, candidate: { ...entry.candidate } };
    }
    case 'download-started': {
      return { kind: 'download-started', at, candidate: { ...entry.candidate } };
    }
    case 'download-failed': {
      return {
        kind: 'download-failed',
        at,
        candidate: { ...entry.candidate },
        reason: entry.reason,
      };
    }
    case 'validation-failed': {
      return {
        kind: 'validation-failed',
        at,
        candidate: { ...entry.candidate },
        reasons: [...entry.reasons],
      };
    }
    case 'imported': {
      return { kind: 'imported', at, candidate: { ...entry.candidate }, location: entry.location };
    }
    case 'fulfillment-rejected': {
      return {
        kind: 'fulfillment-rejected',
        at,
        candidate: { ...entry.candidate },
        reasons: [...entry.reasons],
      };
    }
  }
}

export function statusViewToDto(view: DownloadStatusView): AcquisitionStatusResponseDto {
  return {
    acquisitionId: view.acquisitionId,
    status: view.status,
    transferStarted: view.transferStarted,
    target: view.target ? { ...view.target } : undefined,
    requestedTarget: view.requestedTarget ? requestToWire(view.requestedTarget) : undefined,
    requestedAt: view.requestedAt,
    currentCandidate: view.currentCandidate ? { ...view.currentCandidate } : undefined,
    attempts: view.attempts,
    rejectedCount: view.rejectedCount,
    location: view.location,
    history: view.history.map((item) => historyEntryToDto(item)),
    candidates: view.candidates?.map((candidate) => ({ ...candidate })),
    cancellable: view.cancellable,
    awaitingSelection: view.awaitingSelection,
    stalled: view.stalled,
  };
}

export function progressToDto(progress: TransferProgress): ProgressResponseDto {
  return {
    percent: progress.percent,
    bytesTransferred: progress.bytesTransferred,
    bytesTotal: progress.bytesTotal,
    queuePosition: progress.queuePosition,
  };
}

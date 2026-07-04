import { Result } from 'neverthrow';
import type { AcquisitionRequest } from '../../domain/acquisition/events.js';
import type { AcquisitionPolicies } from '../../domain/policy/policies.js';
import {
  DEFAULT_DOWNLOAD_POLICY,
  DEFAULT_MATCH_POLICY,
  DEFAULT_RETRY_POLICY,
  createDownloadPolicy,
  createMatchPolicy,
  createRetryPolicy,
} from '../../domain/policy/policies.js';
import { DEFAULT_QUALITY_POLICY, createQualityPolicy } from '../../domain/policy/quality-policy.js';
import type { DownloadProgress } from '../../application/ports/outbound-ports.js';
import type {
  AcquisitionStatusView,
  StatusHistoryEntry,
} from '../../application/projections/read-models.js';
import type {
  AcquisitionRequestDto,
  AcquisitionStatusResponseDto,
  ProgressResponseDto,
  SubmitAcquisitionRequestDto,
} from './schemas.js';

/**
 * The inbound/outbound anti-corruption boundary (D12): validated wire DTOs are mapped to domain
 * inputs and read-model views are mapped back to versioned DTOs, so the domain can evolve without
 * breaking the wire. Policies are resolved by folding the (all-optional) request policy fields over
 * the domain defaults through the domain smart constructors, so an inconsistent policy is rejected.
 */

type HistoryDto = AcquisitionStatusResponseDto['history'][number];

export function requestToDomain(dto: AcquisitionRequestDto): AcquisitionRequest {
  // The wire request mirrors the domain request today; the explicit boundary lets them diverge.
  return dto;
}

export function resolvePolicies(
  dto: SubmitAcquisitionRequestDto,
): Result<AcquisitionPolicies, 'InvalidPolicy'> {
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

function historyEntryToDto(entry: StatusHistoryEntry): HistoryDto {
  const candidate = { ...entry.candidate };
  switch (entry.kind) {
    case 'selected':
      return { kind: 'selected', candidate };
    case 'download-failed':
      return { kind: 'download-failed', candidate, reason: entry.reason };
    case 'validation-failed':
      return { kind: 'validation-failed', candidate, reasons: [...entry.reasons] };
    case 'imported':
      return { kind: 'imported', candidate, location: entry.location };
  }
}

export function statusViewToDto(view: AcquisitionStatusView): AcquisitionStatusResponseDto {
  return {
    acquisitionId: view.acquisitionId,
    status: view.status,
    currentCandidate: view.currentCandidate ? { ...view.currentCandidate } : undefined,
    attempts: view.attempts,
    rejectedCount: view.rejectedCount,
    location: view.location,
    history: view.history.map(historyEntryToDto),
  };
}

export function progressToDto(progress: DownloadProgress): ProgressResponseDto {
  return {
    percent: progress.percent,
    bytesTransferred: progress.bytesTransferred,
    bytesTotal: progress.bytesTotal,
    queuePosition: progress.queuePosition,
  };
}

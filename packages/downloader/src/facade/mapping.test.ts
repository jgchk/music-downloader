import { describe, expect, it } from 'vitest';
import { asCandidateIdentity } from '../domain/shared/__fixtures__/candidate-identity.js';
import { DEFAULT_MATCH_POLICY } from '../domain/policy/policies.js';
import type { AcquisitionStatusView } from '../application/projections/read-models.js';
import { progressToDto, requestToDomain, resolvePolicies, statusViewToDto } from './mapping.js';

describe('requestToDomain', () => {
  const MBID = '11111111-1111-4111-8111-111111111111';

  it('parses a musicbrainz request id into a domain mbid', () => {
    expect(
      requestToDomain({ kind: 'musicbrainz', mbid: MBID, targetType: 'album' })._unsafeUnwrap(),
    ).toEqual({ kind: 'musicbrainz', mbid: MBID, targetType: 'album' });
  });

  it('parses a release-group request id into a domain mbid', () => {
    expect(
      requestToDomain({ kind: 'release-group', mbid: MBID, targetType: 'album' })._unsafeUnwrap(),
    ).toEqual({ kind: 'release-group', mbid: MBID, targetType: 'album' });
  });

  it('carries a descriptor request through unchanged (no id to parse)', () => {
    const descriptor = {
      kind: 'descriptor' as const,
      targetType: 'album' as const,
      artist: 'Radiohead',
      title: 'Kid A',
    };
    expect(requestToDomain(descriptor)._unsafeUnwrap()).toEqual(descriptor);
  });

  it('rejects a malformed MusicBrainz id as a modeled error', () => {
    expect(
      requestToDomain({
        kind: 'musicbrainz',
        mbid: 'not-a-uuid',
        targetType: 'album',
      })._unsafeUnwrapErr(),
    ).toEqual({ kind: 'InvalidMbid', value: 'not-a-uuid' });
  });
});

describe('resolvePolicies', () => {
  it('fills every policy from the domain defaults when none are supplied', () => {
    const policies = resolvePolicies({
      request: { kind: 'musicbrainz', mbid: 'rel-1', targetType: 'album' },
    })._unsafeUnwrap();

    expect(policies.match).toEqual(DEFAULT_MATCH_POLICY);
    expect(policies.retry.maxSearchRounds).toBe(3);
    expect(policies.download.stallTimeoutMs).toBeGreaterThan(0);
    expect(policies.quality.floor).toBe('LOSSY_LOW');
  });

  it('applies supplied policy overrides', () => {
    const policies = resolvePolicies({
      request: { kind: 'musicbrainz', mbid: 'rel-1', targetType: 'album' },
      qualityPolicy: { order: ['LOSSLESS', 'LOSSY_HIGH'], floor: 'LOSSY_HIGH' },
      matchPolicy: { threshold: 0.9 },
      retryPolicy: { maxSearchRounds: 5, maxTotalAttempts: 20, timeBudgetMs: 1000 },
      downloadPolicy: { stallTimeoutMs: 5, maxQueueWaitMs: 10 },
    })._unsafeUnwrap();

    expect(policies.match.threshold).toBe(0.9);
    expect(policies.quality.floor).toBe('LOSSY_HIGH');
    expect(policies.retry.timeBudgetMs).toBe(1000);
  });

  it('rejects a floor that is not part of a custom order', () => {
    const result = resolvePolicies({
      request: { kind: 'musicbrainz', mbid: 'rel-1', targetType: 'album' },
      qualityPolicy: { order: ['LOSSLESS'], floor: 'UNKNOWN' },
    });

    expect(result._unsafeUnwrapErr()).toBe('InvalidPolicy');
  });
});

describe('statusViewToDto', () => {
  const candidate = asCandidateIdentity({ username: 'u1', path: 'p', sizeBytes: 100 });

  it('maps every history-entry kind and the current candidate', () => {
    const view: AcquisitionStatusView = {
      acquisitionId: 'acq-1',
      status: 'Downloading',
      currentCandidate: candidate,
      attempts: 2,
      rejectedCount: 1,
      location: '/lib/a',
      history: [
        { kind: 'selected', at: 't0', candidate },
        { kind: 'download-failed', at: 't1', candidate, reason: 'Stalled' },
        { kind: 'validation-failed', at: 't2', candidate, reasons: ['Unplayable'] },
        { kind: 'imported', at: 't3', candidate, location: '/lib/a' },
        { kind: 'fulfillment-rejected', at: 't4', candidate, reasons: ['corrupt stub'] },
      ],
      cancellable: true,
      awaitingSelection: false,
    };

    const dto = statusViewToDto(view);

    expect(dto.currentCandidate).toEqual(candidate);
    expect(dto.history.map((entry) => entry.kind)).toEqual([
      'selected',
      'download-failed',
      'validation-failed',
      'imported',
      'fulfillment-rejected',
    ]);
    expect(dto.history.map((entry) => entry.at)).toEqual(['t0', 't1', 't2', 't3', 't4']);
  });

  it('omits an absent current candidate', () => {
    const view: AcquisitionStatusView = {
      acquisitionId: 'acq-1',
      status: 'Pending',
      attempts: 0,
      rejectedCount: 0,
      history: [],
      cancellable: true,
      awaitingSelection: false,
    };

    expect(statusViewToDto(view).currentCandidate).toBeUndefined();
  });

  it('passes the stalled exposure through to the wire', () => {
    const view: AcquisitionStatusView = {
      acquisitionId: 'acq-1',
      status: 'Downloading',
      attempts: 0,
      rejectedCount: 0,
      history: [],
      cancellable: true,
      awaitingSelection: false,
      stalled: true,
    };

    expect(statusViewToDto(view).stalled).toBe(true);
  });

  it('carries the decided lifecycle flags through to the wire', () => {
    const cancellableAwaiting: AcquisitionStatusView = {
      acquisitionId: 'acq-1',
      status: 'AwaitingManualSelection',
      attempts: 0,
      rejectedCount: 0,
      history: [],
      cancellable: true,
      awaitingSelection: true,
    };
    const cancellableDto = statusViewToDto(cancellableAwaiting);
    expect(cancellableDto.cancellable).toBe(true);
    expect(cancellableDto.awaitingSelection).toBe(true);

    const terminal: AcquisitionStatusView = {
      acquisitionId: 'acq-2',
      status: 'Fulfilled',
      attempts: 0,
      rejectedCount: 0,
      history: [],
      cancellable: false,
      awaitingSelection: false,
    };
    const terminalDto = statusViewToDto(terminal);
    expect(terminalDto.cancellable).toBe(false);
    expect(terminalDto.awaitingSelection).toBe(false);
  });
});

describe('progressToDto', () => {
  it('projects a progress snapshot onto the wire shape', () => {
    expect(
      progressToDto({ percent: 50, bytesTransferred: 5, bytesTotal: 10, queuePosition: 2 }),
    ).toEqual({ percent: 50, bytesTransferred: 5, bytesTotal: 10, queuePosition: 2 });
  });
});

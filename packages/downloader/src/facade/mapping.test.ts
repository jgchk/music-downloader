import { describe, expect, it } from 'vitest';
import { asCandidateIdentity } from '../domain/shared/__fixtures__/candidate-identity.js';
import { asMbid } from '../domain/shared/__fixtures__/mbid.js';
import {
  DEFAULT_DOWNLOAD_POLICY,
  DEFAULT_MATCH_POLICY,
  DEFAULT_RETRY_POLICY,
} from '../domain/policy/policies.js';
import { DEFAULT_QUALITY_POLICY } from '../domain/policy/quality-policy.js';
import type { DownloadStatusView } from '../application/projections/read-models.js';
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

    expect(policies).toEqual({
      quality: DEFAULT_QUALITY_POLICY,
      match: DEFAULT_MATCH_POLICY,
      retry: DEFAULT_RETRY_POLICY,
      download: DEFAULT_DOWNLOAD_POLICY,
    });
  });

  it('applies supplied policy overrides', () => {
    const policies = resolvePolicies({
      request: { kind: 'musicbrainz', mbid: 'rel-1', targetType: 'album' },
      qualityPolicy: { order: ['LOSSLESS', 'LOSSY_HIGH'], floor: 'LOSSY_HIGH' },
      matchPolicy: { threshold: 0.9 },
      retryPolicy: { maxSearchRounds: 5, maxTotalAttempts: 20, timeBudgetMs: 1000 },
      downloadPolicy: { stallTimeoutMs: 5, maxQueueWaitMs: 10 },
    })._unsafeUnwrap();

    expect(policies).toEqual({
      quality: { order: ['LOSSLESS', 'LOSSY_HIGH'], floor: 'LOSSY_HIGH' },
      match: { threshold: 0.9 },
      retry: { maxSearchRounds: 5, maxTotalAttempts: 20, timeBudgetMs: 1000 },
      download: { stallTimeoutMs: 5, maxQueueWaitMs: 10 },
    });
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
  const MBID = '11111111-1111-4111-8111-111111111111';

  /** A view of a download whose metadata never resolved, so only the request describes it. */
  const unresolvedView = (requestedTarget: DownloadStatusView['requestedTarget']) =>
    ({
      acquisitionId: 'acq-1',
      status: 'MetadataFailed',
      transferStarted: false,
      requestedTarget,
      attempts: 0,
      rejectedCount: 0,
      history: [],
      cancellable: false,
      awaitingSelection: false,
    }) satisfies DownloadStatusView;

  it('maps every history-entry kind and the current candidate', () => {
    const request = {
      kind: 'descriptor' as const,
      targetType: 'album' as const,
      artist: 'A',
      title: 'T',
    };
    const view: DownloadStatusView = {
      acquisitionId: 'acq-1',
      status: 'Downloading',
      transferStarted: true,
      currentCandidate: candidate,
      attempts: 2,
      rejectedCount: 1,
      location: '/lib/a',
      history: [
        { kind: 'requested', at: 'r0', request },
        { kind: 'resolved', at: 'r1', artist: 'A', title: 'T', year: 1975 },
        { kind: 'search-started', at: 'r2', round: 1 },
        { kind: 'selected', at: 't0', candidate },
        { kind: 'download-started', at: 't0b', candidate },
        { kind: 'download-failed', at: 't1', candidate, reason: 'Stalled' },
        { kind: 'validation-failed', at: 't2', candidate, reasons: ['Unplayable'] },
        { kind: 'imported', at: 't3', candidate, location: '/lib/a' },
        { kind: 'fulfillment-rejected', at: 't4', candidate, reasons: ['corrupt stub'] },
        { kind: 'fulfilled', at: 'z0', location: '/lib/a' },
        { kind: 'exhausted', at: 'z1' },
        { kind: 'conflicted', at: 'z2', location: '/lib/occupied' },
        { kind: 'metadata-failed', at: 'z3' },
        { kind: 'cancelled', at: 'z4' },
      ],
      cancellable: true,
      awaitingSelection: false,
    };

    const dto = statusViewToDto(view);

    expect(dto.currentCandidate).toEqual(candidate);
    // The whole projected timeline, in order and field for field: every kind keeps its own payload
    // (the candidate it concerns, the reasons it was rejected for, where it landed).
    expect(dto.history).toEqual([
      { kind: 'requested', at: 'r0', request },
      { kind: 'resolved', at: 'r1', artist: 'A', title: 'T', year: 1975 },
      { kind: 'search-started', at: 'r2', round: 1 },
      { kind: 'selected', at: 't0', candidate },
      { kind: 'download-started', at: 't0b', candidate },
      { kind: 'download-failed', at: 't1', candidate, reason: 'Stalled' },
      { kind: 'validation-failed', at: 't2', candidate, reasons: ['Unplayable'] },
      { kind: 'imported', at: 't3', candidate, location: '/lib/a' },
      { kind: 'fulfillment-rejected', at: 't4', candidate, reasons: ['corrupt stub'] },
      { kind: 'fulfilled', at: 'z0', location: '/lib/a' },
      { kind: 'exhausted', at: 'z1' },
      { kind: 'conflicted', at: 'z2', location: '/lib/occupied' },
      { kind: 'metadata-failed', at: 'z3' },
      { kind: 'cancelled', at: 'z4' },
    ]);
  });

  it('carries when the download was requested onto the wire', () => {
    const view: DownloadStatusView = {
      ...unresolvedView({ kind: 'musicbrainz', mbid: asMbid(MBID), targetType: 'album' }),
      requestedAt: '2026-01-01T00:00:00Z',
    };

    expect(statusViewToDto(view).requestedAt).toBe('2026-01-01T00:00:00Z');
  });

  it('echoes the requested target onto the wire under the kind that was asked for', () => {
    // A release, a release group and a free-text descriptor are three different asks, and a
    // consumer describes them differently — the echoed kind must survive the crossing intact.
    expect(
      statusViewToDto(
        unresolvedView({ kind: 'musicbrainz', mbid: asMbid(MBID), targetType: 'album' }),
      ).requestedTarget,
    ).toEqual({ kind: 'musicbrainz', mbid: MBID, targetType: 'album' });

    expect(
      statusViewToDto(
        unresolvedView({ kind: 'release-group', mbid: asMbid(MBID), targetType: 'album' }),
      ).requestedTarget,
    ).toEqual({ kind: 'release-group', mbid: MBID, targetType: 'album' });

    expect(
      statusViewToDto(
        unresolvedView({
          kind: 'descriptor',
          targetType: 'album',
          artist: 'A',
          title: 'T',
          album: 'Al',
        }),
      ).requestedTarget,
    ).toEqual({ kind: 'descriptor', targetType: 'album', artist: 'A', title: 'T', album: 'Al' });
  });

  it('leaves the resolved target absent until metadata resolves, then carries it', () => {
    expect(
      statusViewToDto(
        unresolvedView({ kind: 'musicbrainz', mbid: asMbid(MBID), targetType: 'album' }),
      ).target,
    ).toBeUndefined();

    const resolved: DownloadStatusView = {
      acquisitionId: 'acq-1',
      status: 'Downloading',
      transferStarted: true,
      target: { artist: 'Pink Floyd', title: 'Animals' },
      attempts: 1,
      rejectedCount: 0,
      history: [],
      cancellable: true,
      awaitingSelection: false,
    };

    expect(statusViewToDto(resolved).target).toEqual({ artist: 'Pink Floyd', title: 'Animals' });
  });

  it('omits an absent current candidate', () => {
    const view: DownloadStatusView = {
      acquisitionId: 'acq-1',
      status: 'Pending',
      transferStarted: false,
      attempts: 0,
      rejectedCount: 0,
      history: [],
      cancellable: true,
      awaitingSelection: false,
    };

    expect(statusViewToDto(view).currentCandidate).toBeUndefined();
  });

  it('passes the stalled exposure through to the wire', () => {
    const view: DownloadStatusView = {
      acquisitionId: 'acq-1',
      status: 'Downloading',
      transferStarted: false,
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
    const cancellableAwaiting: DownloadStatusView = {
      acquisitionId: 'acq-1',
      status: 'AwaitingManualSelection',
      transferStarted: false,
      attempts: 0,
      rejectedCount: 0,
      history: [],
      cancellable: true,
      awaitingSelection: true,
    };
    const cancellableDto = statusViewToDto(cancellableAwaiting);
    expect(cancellableDto.cancellable).toBe(true);
    expect(cancellableDto.awaitingSelection).toBe(true);

    const terminal: DownloadStatusView = {
      acquisitionId: 'acq-2',
      status: 'Fulfilled',
      transferStarted: false,
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

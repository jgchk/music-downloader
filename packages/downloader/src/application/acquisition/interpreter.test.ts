import { errAsync, okAsync } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { interpretEffect } from './interpreter.js';
import type { EffectPorts, InterpreterDeps } from './interpreter.js';
import { FakeEventStore, fixedClock } from '../__fixtures__/fakes.js';
import { infraError } from '../ports/errors.js';
import { createMatchPolicy, DEFAULT_DOWNLOAD_POLICY } from '../../domain/policy/policies.js';
import { asMbid } from '../../domain/shared/__fixtures__/mbid.js';
import type { DownloadProgress } from '../ports/outbound-ports.js';
import type { AcquisitionEvent } from '../../domain/acquisition/events.js';
import {
  awaitingSelectionHistory,
  defaultPolicies,
  importingHistory,
  matchingCandidate,
  requestedHistory,
  resolvedHistory,
  sampleEditionCandidates,
  sampleFiles,
  sampleGroupRequest,
  sampleRequest,
  sampleTarget,
  selectedHistory,
  validatingHistory,
} from '../../domain/acquisition/__fixtures__/acquisition-fixtures.js';

function stubPorts(overrides: Partial<EffectPorts> = {}): EffectPorts {
  return {
    metadata: { resolve: vi.fn() },
    search: { search: vi.fn() },
    download: { download: vi.fn(), abort: vi.fn() },
    probe: { probe: vi.fn() },
    library: { import: vi.fn(), discardStaging: vi.fn() },
    ...overrides,
  };
}

let store: FakeEventStore;
const onProgress = vi.fn();

function deps(ports: EffectPorts): InterpreterDeps {
  return { store, clock: fixedClock(), ports, onProgress };
}

async function seed(history: readonly AcquisitionEvent[]): Promise<void> {
  await store.append('acq-1', 0, history, { acquisitionId: 'acq-1', occurredAt: 't' });
}

function appendedTypes(): string[] {
  return store.all().map((entry) => entry.type);
}

beforeEach(() => {
  store = new FakeEventStore();
  onProgress.mockClear();
});

describe('interpretEffect — metadata resolution', () => {
  it('records the resolved target', async () => {
    await seed(requestedHistory());
    const ports = stubPorts({
      metadata: {
        resolve: vi.fn(() => okAsync({ kind: 'resolved' as const, target: sampleTarget })),
      },
    });
    await interpretEffect(deps(ports), 'acq-1', {
      type: 'ResolveMetadata',
      request: sampleRequest,
    });
    expect(appendedTypes()).toContain('TargetResolved');
  });

  it('records a metadata resolution failure', async () => {
    await seed(requestedHistory());
    const ports = stubPorts({
      metadata: { resolve: vi.fn(() => okAsync({ kind: 'unresolved' as const })) },
    });
    await interpretEffect(deps(ports), 'acq-1', {
      type: 'ResolveMetadata',
      request: { kind: 'musicbrainz', mbid: asMbid('x'), targetType: 'album' },
    });
    expect(appendedTypes()).toContain('MetadataResolutionFailed');
  });

  it('records a needs-selection outcome as a manual-selection request, candidates verbatim', async () => {
    await seed([
      { type: 'AcquisitionRequested', request: sampleGroupRequest, policies: defaultPolicies() },
    ]);
    const ports = stubPorts({
      metadata: {
        resolve: vi.fn(() =>
          okAsync({ kind: 'needsSelection' as const, candidates: sampleEditionCandidates }),
        ),
      },
    });
    await interpretEffect(deps(ports), 'acq-1', {
      type: 'ResolveMetadata',
      request: sampleGroupRequest,
    });
    const paused = store
      .all()
      .map((entry) => entry.event)
      .find(
        (event): event is Extract<AcquisitionEvent, { type: 'ManualSelectionRequested' }> =>
          event.type === 'ManualSelectionRequested',
      );
    expect(paused?.candidates).toEqual(sampleEditionCandidates);
  });

  it('resolves the chosen edition on the resume path and records the target', async () => {
    await seed([
      ...awaitingSelectionHistory(),
      { type: 'EditionSelected', releaseMbid: asMbid('boot-1') },
    ]);
    const ports = stubPorts({
      metadata: {
        resolve: vi.fn(() => okAsync({ kind: 'resolved' as const, target: sampleTarget })),
      },
    });
    // The effect `react` emits for EditionSelected: the direct-by-release-id request.
    await interpretEffect(deps(ports), 'acq-1', {
      type: 'ResolveMetadata',
      request: { kind: 'musicbrainz', mbid: asMbid('boot-1'), targetType: 'album' },
    });
    const resolved = store
      .all()
      .map((entry) => entry.event)
      .find(
        (event): event is Extract<AcquisitionEvent, { type: 'TargetResolved' }> =>
          event.type === 'TargetResolved',
      );
    expect(resolved?.target).toEqual(sampleTarget);
  });

  it('propagates an infrastructure fault without appending', async () => {
    await seed(requestedHistory());
    const ports = stubPorts({
      metadata: { resolve: vi.fn(() => errAsync(infraError('mb', 'down'))) },
    });
    const result = await interpretEffect(deps(ports), 'acq-1', {
      type: 'ResolveMetadata',
      request: { kind: 'musicbrainz', mbid: asMbid('x'), targetType: 'album' },
    });
    expect(result._unsafeUnwrapErr()).toMatchObject({ kind: 'InfraError' });
  });
});

describe('interpretEffect — search', () => {
  it('records and ranks search results', async () => {
    await seed(resolvedHistory());
    const ports = stubPorts({
      search: { search: vi.fn(() => okAsync([matchingCandidate('a')])) },
    });
    await interpretEffect(deps(ports), 'acq-1', { type: 'Search', target: sampleTarget, round: 1 });
    expect(appendedTypes()).toEqual(
      expect.arrayContaining(['SearchCompleted', 'CandidatesRanked', 'CandidateSelected']),
    );
  });
});

describe('interpretEffect — download', () => {
  it('reports progress and records a completed download', async () => {
    await seed(selectedHistory([matchingCandidate('a')]));
    const ports = stubPorts({
      download: {
        download: vi.fn((_a, _c, _p, cb: (progress: DownloadProgress) => void) => {
          cb({ percent: 50, bytesTransferred: 5, bytesTotal: 10 });
          return okAsync({ kind: 'completed' as const, files: sampleFiles });
        }),
        abort: vi.fn(),
      },
    });
    await interpretEffect(deps(ports), 'acq-1', {
      type: 'Download',
      candidate: matchingCandidate('a'),
      policy: DEFAULT_DOWNLOAD_POLICY,
    });
    expect(appendedTypes()).toContain('DownloadCompleted');
    expect(onProgress).toHaveBeenCalledOnce();
  });

  it('records a failed download', async () => {
    await seed(selectedHistory([matchingCandidate('a')]));
    const ports = stubPorts({
      download: {
        download: vi.fn(() =>
          okAsync({ kind: 'failed' as const, reason: 'PeerUnavailable' as const }),
        ),
        abort: vi.fn(),
      },
    });
    await interpretEffect(deps(ports), 'acq-1', {
      type: 'Download',
      candidate: matchingCandidate('a'),
      policy: DEFAULT_DOWNLOAD_POLICY,
    });
    expect(appendedTypes()).toContain('DownloadFailed');
  });

  it('aborts an in-flight transfer and rejects the pending candidate on cancellation', async () => {
    const candidate = matchingCandidate('a');
    await seed([...selectedHistory([candidate]), { type: 'AcquisitionCancelled' }]);
    const abort = vi.fn(() => okAsync([]));
    const ports = stubPorts({ download: { download: vi.fn(), abort } });

    await interpretEffect(deps(ports), 'acq-1', { type: 'AbortDownload', candidate });

    expect(abort).toHaveBeenCalledWith('acq-1', candidate);
    // The settlement rejects the pending candidate; the acquisition stays cancelled.
    expect(appendedTypes()).toContain('CandidateRejected');
  });

  it('threads a failed download’s partial files into the rejection for cleanup', async () => {
    await seed(selectedHistory([matchingCandidate('a')]));
    const ports = stubPorts({
      download: {
        download: vi.fn(() =>
          okAsync({ kind: 'failed' as const, reason: 'Stalled' as const, files: sampleFiles }),
        ),
        abort: vi.fn(),
      },
    });
    await interpretEffect(deps(ports), 'acq-1', {
      type: 'Download',
      candidate: matchingCandidate('a'),
      policy: DEFAULT_DOWNLOAD_POLICY,
    });
    const rejected = store.all().find((entry) => entry.type === 'CandidateRejected')?.event as
      Extract<AcquisitionEvent, { type: 'CandidateRejected' }> | undefined;
    expect(rejected?.files).toEqual(sampleFiles);
  });

  it('cleans an aborted candidate’s already-completed files reported by the abort', async () => {
    const candidate = matchingCandidate('a');
    await seed([...selectedHistory([candidate]), { type: 'AcquisitionCancelled' }]);
    const abort = vi.fn(() => okAsync(sampleFiles));
    const discardStaging = vi.fn(() => okAsync(undefined));
    const ports = stubPorts({
      download: { download: vi.fn(), abort },
      library: { import: vi.fn(), discardStaging },
    });

    await interpretEffect(deps(ports), 'acq-1', { type: 'AbortDownload', candidate });

    const rejected = store.all().find((entry) => entry.type === 'CandidateRejected')?.event as
      Extract<AcquisitionEvent, { type: 'CandidateRejected' }> | undefined;
    expect(rejected?.files).toEqual(sampleFiles);
  });

  it('propagates an abort infrastructure fault without appending', async () => {
    const candidate = matchingCandidate('a');
    await seed([...selectedHistory([candidate]), { type: 'AcquisitionCancelled' }]);
    const ports = stubPorts({
      download: {
        download: vi.fn(),
        abort: vi.fn(() => errAsync(infraError('slskd.abort', 'boom'))),
      },
    });

    const result = await interpretEffect(deps(ports), 'acq-1', {
      type: 'AbortDownload',
      candidate,
    });

    expect(result._unsafeUnwrapErr()).toMatchObject({ kind: 'InfraError' });
    expect(appendedTypes()).not.toContain('CandidateRejected');
  });
});

describe('interpretEffect — validation', () => {
  it('records a passing validation', async () => {
    await seed(validatingHistory([matchingCandidate('a')]));
    const ports = stubPorts({
      probe: {
        probe: vi.fn((path: string) =>
          okAsync({
            decodedCleanly: true,
            codec: 'flac',
            durationMs: path.includes('01') ? 251000 : 264000,
          }),
        ),
      },
    });
    await interpretEffect(deps(ports), 'acq-1', {
      type: 'Validate',
      files: sampleFiles,
      target: sampleTarget,
      matchPolicy: createMatchPolicy(0.5)._unsafeUnwrap(),
    });
    expect(appendedTypes()).toContain('ValidationPassed');
  });

  it('records a failing validation', async () => {
    await seed(validatingHistory([matchingCandidate('a')]));
    const ports = stubPorts({
      probe: {
        probe: vi.fn(() => okAsync({ decodedCleanly: false, codec: 'flac', durationMs: 0 })),
      },
    });
    await interpretEffect(deps(ports), 'acq-1', {
      type: 'Validate',
      files: sampleFiles,
      target: sampleTarget,
      matchPolicy: createMatchPolicy(0.9)._unsafeUnwrap(),
    });
    expect(appendedTypes()).toContain('ValidationFailed');
  });
});

describe('interpretEffect — import and cleanup', () => {
  it('records a successful import and fulfilment', async () => {
    await seed(importingHistory([matchingCandidate('a')]));
    const ports = stubPorts({
      library: {
        import: vi.fn(() => okAsync({ kind: 'imported' as const, location: '/lib/x' })),
        discardStaging: vi.fn(),
      },
    });
    await interpretEffect(deps(ports), 'acq-1', {
      type: 'Import',
      files: sampleFiles,
      target: sampleTarget,
    });
    expect(appendedTypes()).toEqual(expect.arrayContaining(['Imported', 'AcquisitionFulfilled']));
  });

  it('records an import conflict', async () => {
    await seed(importingHistory([matchingCandidate('a')]));
    const ports = stubPorts({
      library: {
        import: vi.fn(() => okAsync({ kind: 'conflict' as const, location: '/lib/x' })),
        discardStaging: vi.fn(),
      },
    });
    await interpretEffect(deps(ports), 'acq-1', {
      type: 'Import',
      files: sampleFiles,
      target: sampleTarget,
    });
    expect(appendedTypes()).toContain('ImportConflicted');
  });

  it('discards staging on cleanup without appending events', async () => {
    await seed(selectedHistory([matchingCandidate('a')]));
    const discardStaging = vi.fn(() => okAsync(undefined));
    const ports = stubPorts({
      library: { import: vi.fn(), discardStaging },
    });
    const result = await interpretEffect(deps(ports), 'acq-1', {
      type: 'Cleanup',
      files: sampleFiles,
    });
    expect(result._unsafeUnwrap()).toEqual([]);
    expect(discardStaging).toHaveBeenCalledWith(sampleFiles);
  });
});

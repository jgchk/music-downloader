import { appendMetadata, testScope } from '../__fixtures__/correlation.js';

/** One scope instance: the port assertions below pin that the SAME scope reaches the adapter. */
const SCOPE = testScope();
import { errAsync, okAsync } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { interpretEffect } from './interpreter.js';
import type { EffectPorts, InterpreterDependencies } from './interpreter.js';
import { FakeEventStore, fixedClock } from '../__fixtures__/fakes.js';
import { infraError } from '../ports/errors.js';
import { createMatchPolicy, DEFAULT_DOWNLOAD_POLICY } from '../../domain/policy/policies.js';
import { asMbid } from '../../domain/shared/__fixtures__/mbid.js';
import type { DownloadEvent } from '../../domain/download/events.js';
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
  startedHistory,
  validatingHistory,
} from '../../domain/download/__fixtures__/download-fixtures.js';

function stubPorts(overrides: Partial<EffectPorts> = {}): EffectPorts {
  return {
    metadata: { resolve: vi.fn() },
    search: { search: vi.fn() },
    download: { start: vi.fn(), abort: vi.fn() },
    probe: { probe: vi.fn() },
    library: { import: vi.fn(), discardStaging: vi.fn() },
    ...overrides,
  };
}

let store: FakeEventStore;

function dependencies(ports: EffectPorts): InterpreterDependencies {
  return { store, clock: fixedClock(), ports };
}

async function seed(history: readonly DownloadEvent[]): Promise<void> {
  await store.append('acq-1', 0, history, appendMetadata('acq-1', fixedClock()));
}

function appendedTypes(): string[] {
  return store.all().map((entry) => entry.type);
}

beforeEach(() => {
  store = new FakeEventStore();
});

describe('interpretEffect — metadata resolution', () => {
  it('records the resolved target', async () => {
    await seed(requestedHistory());
    const ports = stubPorts({
      metadata: {
        resolve: vi.fn(() => okAsync({ kind: 'resolved' as const, target: sampleTarget })),
      },
    });
    await interpretEffect(
      dependencies(ports),
      'acq-1',
      {
        type: 'ResolveMetadata',
        request: sampleRequest,
      },
      SCOPE,
    );
    expect(appendedTypes()).toContain('TargetResolved');
  });

  it('records a metadata resolution failure', async () => {
    await seed(requestedHistory());
    const ports = stubPorts({
      metadata: { resolve: vi.fn(() => okAsync({ kind: 'unresolved' as const })) },
    });
    await interpretEffect(
      dependencies(ports),
      'acq-1',
      {
        type: 'ResolveMetadata',
        request: { kind: 'musicbrainz', mbid: asMbid('x'), targetType: 'album' },
      },
      SCOPE,
    );
    expect(appendedTypes()).toContain('MetadataResolutionFailed');
  });

  it('records a needs-selection outcome as a manual-selection request, candidates verbatim', async () => {
    await seed([
      { type: 'DownloadRequested', request: sampleGroupRequest, policies: defaultPolicies() },
    ]);
    const ports = stubPorts({
      metadata: {
        resolve: vi.fn(() =>
          okAsync({ kind: 'needsSelection' as const, candidates: sampleEditionCandidates }),
        ),
      },
    });
    await interpretEffect(
      dependencies(ports),
      'acq-1',
      {
        type: 'ResolveMetadata',
        request: sampleGroupRequest,
      },
      SCOPE,
    );
    const paused = store
      .all()
      .map((entry) => entry.event)
      .find(
        (event): event is Extract<DownloadEvent, { type: 'ManualSelectionRequested' }> =>
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
    await interpretEffect(
      dependencies(ports),
      'acq-1',
      {
        type: 'ResolveMetadata',
        request: { kind: 'musicbrainz', mbid: asMbid('boot-1'), targetType: 'album' },
      },
      SCOPE,
    );
    const resolved = store
      .all()
      .map((entry) => entry.event)
      .find(
        (event): event is Extract<DownloadEvent, { type: 'TargetResolved' }> =>
          event.type === 'TargetResolved',
      );
    expect(resolved?.target).toEqual(sampleTarget);
  });

  it('propagates an infrastructure fault without appending', async () => {
    await seed(requestedHistory());
    const ports = stubPorts({
      metadata: { resolve: vi.fn(() => errAsync(infraError('mb', 'down'))) },
    });
    const result = await interpretEffect(
      dependencies(ports),
      'acq-1',
      {
        type: 'ResolveMetadata',
        request: { kind: 'musicbrainz', mbid: asMbid('x'), targetType: 'album' },
      },
      SCOPE,
    );
    expect(result._unsafeUnwrapErr()).toMatchObject({ kind: 'InfraError' });
  });
});

describe('interpretEffect — search', () => {
  it('records and ranks search results', async () => {
    await seed(resolvedHistory());
    const ports = stubPorts({
      search: { search: vi.fn(() => okAsync([matchingCandidate('a')])) },
    });
    await interpretEffect(
      dependencies(ports),
      'acq-1',
      {
        type: 'Search',
        target: sampleTarget,
        round: 1,
      },
      SCOPE,
    );
    expect(appendedTypes()).toEqual(
      expect.arrayContaining(['SearchCompleted', 'CandidatesRanked', 'CandidateSelected']),
    );
  });
});

describe('interpretEffect — download', () => {
  it('starts the watch and records the downloading fact once the source accepts', async () => {
    const candidate = matchingCandidate('a');
    await seed(selectedHistory([candidate]));
    const start = vi.fn(() => okAsync({ kind: 'started' as const }));
    const ports = stubPorts({ download: { start, abort: vi.fn() } });
    await interpretEffect(
      dependencies(ports),
      'acq-1',
      {
        type: 'Download',
        candidate,
        policy: DEFAULT_DOWNLOAD_POLICY,
      },
      SCOPE,
    );
    expect(start).toHaveBeenCalledWith('acq-1', candidate, DEFAULT_DOWNLOAD_POLICY, SCOPE);
    expect(appendedTypes()).toContain('TryStarted');
    // The start returns promptly — no outcome is recorded here; that arrives asynchronously.
    expect(appendedTypes()).not.toContain('TryCompleted');
  });

  it('absorbs a redelivered start report without appending twice (ensure-start)', async () => {
    const candidate = matchingCandidate('a');
    await seed(startedHistory([candidate]));
    const ports = stubPorts({
      download: { start: vi.fn(() => okAsync({ kind: 'started' as const })), abort: vi.fn() },
    });
    await interpretEffect(
      dependencies(ports),
      'acq-1',
      {
        type: 'Download',
        candidate,
        policy: DEFAULT_DOWNLOAD_POLICY,
      },
      SCOPE,
    );
    expect(appendedTypes().filter((type) => type === 'TryStarted')).toHaveLength(1);
  });

  it('records a source-refused enqueue as a failed download for the retry ladder', async () => {
    await seed(selectedHistory([matchingCandidate('a')]));
    const ports = stubPorts({
      download: {
        start: vi.fn(() =>
          okAsync({ kind: 'rejected' as const, reason: 'PeerUnavailable' as const }),
        ),
        abort: vi.fn(),
      },
    });
    await interpretEffect(
      dependencies(ports),
      'acq-1',
      {
        type: 'Download',
        candidate: matchingCandidate('a'),
        policy: DEFAULT_DOWNLOAD_POLICY,
      },
      SCOPE,
    );
    expect(appendedTypes()).toContain('TryFailed');
  });

  it('aborts an in-flight transfer and rejects the pending candidate on cancellation', async () => {
    const candidate = matchingCandidate('a');
    await seed([...selectedHistory([candidate]), { type: 'DownloadCancelled' }]);
    const abort = vi.fn(() => okAsync([]));
    const ports = stubPorts({ download: { start: vi.fn(), abort } });

    await interpretEffect(
      dependencies(ports),
      'acq-1',
      { type: 'AbortDownload', candidate },
      SCOPE,
    );

    expect(abort).toHaveBeenCalledWith('acq-1', candidate, SCOPE);
    // The settlement rejects the pending candidate; the download stays cancelled.
    expect(appendedTypes()).toContain('CandidateRejected');
  });

  it('cleans an aborted candidate’s already-completed files reported by the abort', async () => {
    const candidate = matchingCandidate('a');
    await seed([...selectedHistory([candidate]), { type: 'DownloadCancelled' }]);
    const abort = vi.fn(() => okAsync(sampleFiles));
    const discardStaging = vi.fn(() => okAsync(undefined));
    const ports = stubPorts({
      download: { start: vi.fn(), abort },
      library: { import: vi.fn(), discardStaging },
    });

    await interpretEffect(
      dependencies(ports),
      'acq-1',
      { type: 'AbortDownload', candidate },
      SCOPE,
    );

    const rejected = store.all().find((entry) => entry.type === 'CandidateRejected')?.event as
      Extract<DownloadEvent, { type: 'CandidateRejected' }> | undefined;
    expect(rejected?.files).toEqual(sampleFiles);
  });

  it('propagates an abort infrastructure fault without appending', async () => {
    const candidate = matchingCandidate('a');
    await seed([...selectedHistory([candidate]), { type: 'DownloadCancelled' }]);
    const ports = stubPorts({
      download: {
        start: vi.fn(),
        abort: vi.fn(() => errAsync(infraError('slskd.abort', 'boom'))),
      },
    });

    const result = await interpretEffect(
      dependencies(ports),
      'acq-1',
      {
        type: 'AbortDownload',
        candidate,
      },
      SCOPE,
    );

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
            durationMs: path.includes('01') ? 251_000 : 264_000,
          }),
        ),
      },
    });
    await interpretEffect(
      dependencies(ports),
      'acq-1',
      {
        type: 'Validate',
        files: sampleFiles,
        target: sampleTarget,
        matchPolicy: createMatchPolicy(0.5)._unsafeUnwrap(),
      },
      SCOPE,
    );
    expect(appendedTypes()).toContain('ValidationPassed');
  });

  it('records a failing validation', async () => {
    await seed(validatingHistory([matchingCandidate('a')]));
    const ports = stubPorts({
      probe: {
        probe: vi.fn(() => okAsync({ decodedCleanly: false, codec: 'flac', durationMs: 0 })),
      },
    });
    await interpretEffect(
      dependencies(ports),
      'acq-1',
      {
        type: 'Validate',
        files: sampleFiles,
        target: sampleTarget,
        matchPolicy: createMatchPolicy(0.9)._unsafeUnwrap(),
      },
      SCOPE,
    );
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
    await interpretEffect(
      dependencies(ports),
      'acq-1',
      {
        type: 'Import',
        files: sampleFiles,
        target: sampleTarget,
      },
      SCOPE,
    );
    expect(appendedTypes()).toEqual(expect.arrayContaining(['Imported', 'DownloadFulfilled']));
  });

  it('records an import conflict', async () => {
    await seed(importingHistory([matchingCandidate('a')]));
    const ports = stubPorts({
      library: {
        import: vi.fn(() => okAsync({ kind: 'conflict' as const, location: '/lib/x' })),
        discardStaging: vi.fn(),
      },
    });
    await interpretEffect(
      dependencies(ports),
      'acq-1',
      {
        type: 'Import',
        files: sampleFiles,
        target: sampleTarget,
      },
      SCOPE,
    );
    expect(appendedTypes()).toContain('ImportConflicted');
  });

  it('discards staging on cleanup without appending events', async () => {
    await seed(selectedHistory([matchingCandidate('a')]));
    const discardStaging = vi.fn(() => okAsync(undefined));
    const ports = stubPorts({
      library: { import: vi.fn(), discardStaging },
    });
    const result = await interpretEffect(
      dependencies(ports),
      'acq-1',
      {
        type: 'Cleanup',
        files: sampleFiles,
      },
      SCOPE,
    );
    expect(result._unsafeUnwrap()).toEqual([]);
    expect(discardStaging).toHaveBeenCalledWith(sampleFiles, SCOPE);
  });
});

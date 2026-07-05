import { okAsync } from 'neverthrow';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  InProcessEventBus,
  SqliteCheckpointStore,
  SqliteEventStore,
  UpcasterRegistry,
  openEventDatabase,
} from '../adapters/index.js';
import type { EffectPorts, InterpreterDeps } from '../application/acquisition/interpreter.js';
import { Reactor } from '../application/acquisition/reactor.js';
import type { UseCaseDeps } from '../application/acquisition/use-cases.js';
import { fixedClock, sequentialIds, silentLogger } from '../application/__fixtures__/fakes.js';
import type { DownloadResult, ImportResult } from '../application/ports/outbound-ports.js';
import {
  AcquisitionStatusProjection,
  LibraryViewProjection,
  ProgressReadModel,
} from '../application/projections/read-models.js';
import type { AcquisitionPhase } from '../domain/acquisition/acquisition.js';
import {
  matchingCandidate,
  sampleTarget,
} from '../domain/acquisition/__fixtures__/acquisition-fixtures.js';
import type { Candidate } from '../domain/candidate/candidate.js';
import type { ProbedAudio } from '../domain/validation/validators.js';
import { buildHttpApp } from '../interfaces/http/app.js';
import { buildMcpServer } from '../interfaces/mcp/server.js';

/**
 * The E2E tier (D4): the whole app wired for real — SQLite event store, in-process bus,
 * projections, the durable reactor, and the HTTP + MCP interfaces — driven end to end against
 * fake outbound ports (slskd / MusicBrainz / ffmpeg / library). It exercises the reactor cascade
 * (resolve → search → rank → download → validate → import) that the unit tiers only touch in
 * isolation, covering the happy path, retry-then-succeed, exhaustion, and an import conflict.
 */

const DOWNLOADED_FILES = [
  { path: 'staging/01.flac', name: '01.flac' },
  { path: 'staging/02.flac', name: '02.flac' },
];
const PROBES: Record<string, ProbedAudio> = {
  'staging/01.flac': { decodedCleanly: true, codec: 'flac', durationMs: 251000 },
  'staging/02.flac': { decodedCleanly: true, codec: 'flac', durationMs: 264000 },
};
const COMPLETED: DownloadResult = { kind: 'completed', files: DOWNLOADED_FILES };
const FAILED: DownloadResult = { kind: 'failed', reason: 'Stalled' };
const IMPORTED: ImportResult = { kind: 'imported', location: '/library/Radiohead/Kid A (2000)' };
const CONFLICT: ImportResult = { kind: 'conflict', location: '/library/Radiohead/Kid A (2000)' };

const SUBMIT_BODY = { request: { kind: 'musicbrainz', mbid: 'mbid-1', targetType: 'album' } };

function candidateWithSpeed(username: string, speedBytesPerSec: number): Candidate {
  const base = matchingCandidate(username);
  return { ...base, source: { ...base.source, speedBytesPerSec } };
}

interface E2eOptions {
  searchByRound: (round: number) => readonly Candidate[];
  downloadByUser: Record<string, DownloadResult>;
  importResult: ImportResult;
}

function wire(opts: E2eOptions) {
  const db = openEventDatabase(':memory:');
  const bus = new InProcessEventBus();
  const store = new SqliteEventStore(db, new UpcasterRegistry(), bus);
  const checkpoints = new SqliteCheckpointStore(db);
  const status = new AcquisitionStatusProjection();
  const progressModel = new ProgressReadModel();
  const libraryView = new LibraryViewProjection();
  bus.subscribe((stored) => {
    status.apply(stored);
    libraryView.apply(stored);
  });

  const ports: EffectPorts = {
    metadata: { resolve: () => okAsync({ kind: 'resolved', target: sampleTarget }) },
    search: { search: (_target, round) => okAsync(opts.searchByRound(round)) },
    download: {
      download: (candidate, _policy, onProgress) => {
        const result = opts.downloadByUser[candidate.identity.username] ?? FAILED;
        if (result.kind === 'completed') {
          onProgress({ percent: 100, bytesTransferred: 1, bytesTotal: 1 });
        }
        return okAsync(result);
      },
    },
    probe: { probe: (path) => okAsync(PROBES[path]!) },
    library: { import: () => okAsync(opts.importResult), discardStaging: () => okAsync(undefined) },
  };
  const interpreter: InterpreterDeps = {
    store,
    clock: fixedClock(),
    ports,
    onProgress: (id, _candidate, progress) => progressModel.update(id, progress),
  };
  const reactor = new Reactor({ store, checkpoints, bus, logger: silentLogger(), interpreter });
  const deps: UseCaseDeps = {
    store,
    clock: fixedClock(),
    ids: sequentialIds(),
    status,
    progress: progressModel,
  };
  return { db, reactor, status, progressModel, libraryView, deps };
}

type Wiring = ReturnType<typeof wire>;

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function startHttp(opts: E2eOptions) {
  const w = wire(opts);
  await w.reactor.start();
  const app = await buildHttpApp(w.deps, silentLogger());
  cleanups.push(
    () => app.close(),
    () => w.reactor.stop(),
    () => {
      w.db.close();
    },
  );
  return { w, app };
}

async function settle(w: Wiring, id: string, phase: AcquisitionPhase): Promise<void> {
  await vi.waitFor(() => {
    expect(w.status.get(id)?.status).toBe(phase);
  });
}

const happyOptions: E2eOptions = {
  searchByRound: (round) => (round === 1 ? [candidateWithSpeed('a', 100)] : []),
  downloadByUser: { a: COMPLETED },
  importResult: IMPORTED,
};

describe('acquisition E2E', () => {
  it('fulfills an acquisition end to end over HTTP', async () => {
    const { w, app } = await startHttp(happyOptions);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/acquisitions',
      payload: SUBMIT_BODY,
    });
    const id = res.json<{ acquisitionId: string }>().acquisitionId;
    await settle(w, id, 'Fulfilled');

    const status = await app.inject({ method: 'GET', url: `/api/v1/acquisitions/${id}` });
    expect(status.json<{ location: string }>().location).toBe(IMPORTED.location);

    const progress = await app.inject({
      method: 'GET',
      url: `/api/v1/acquisitions/${id}/progress`,
    });
    expect(progress.json<{ percent: number }>().percent).toBe(100);
    expect(w.libraryView.list()).toHaveLength(1);
  });

  it('rejects a failed candidate and succeeds with the next best (retry-then-succeed)', async () => {
    const { w, app } = await startHttp({
      searchByRound: (round) =>
        round === 1 ? [candidateWithSpeed('a', 200), candidateWithSpeed('b', 100)] : [],
      downloadByUser: { a: FAILED, b: COMPLETED },
      importResult: IMPORTED,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/acquisitions',
      payload: SUBMIT_BODY,
    });
    const id = res.json<{ acquisitionId: string }>().acquisitionId;
    await settle(w, id, 'Fulfilled');

    const view = w.status.get(id)!;
    expect(view.attempts).toBe(2);
    expect(view.rejectedCount).toBe(1);
    expect(view.history.some((entry) => entry.kind === 'download-failed')).toBe(true);
  });

  it('exhausts when every candidate fails and re-search finds nothing', async () => {
    const { w, app } = await startHttp({
      searchByRound: (round) => (round === 1 ? [candidateWithSpeed('a', 100)] : []),
      downloadByUser: { a: FAILED },
      importResult: IMPORTED,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/acquisitions',
      payload: SUBMIT_BODY,
    });
    const id = res.json<{ acquisitionId: string }>().acquisitionId;

    await settle(w, id, 'Exhausted');
  });

  it('reports an import conflict as a terminal conflicted state', async () => {
    const { w, app } = await startHttp({ ...happyOptions, importResult: CONFLICT });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/acquisitions',
      payload: SUBMIT_BODY,
    });
    const id = res.json<{ acquisitionId: string }>().acquisitionId;

    await settle(w, id, 'Conflicted');
  });

  it('fulfills an acquisition submitted over MCP', async () => {
    const w = wire(happyOptions);
    await w.reactor.start();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await buildMcpServer(w.deps, silentLogger()).connect(serverTransport);
    const client = new Client({ name: 'e2e', version: '0' });
    await client.connect(clientTransport);
    cleanups.push(
      () => client.close(),
      () => w.reactor.stop(),
      () => {
        w.db.close();
      },
    );

    const call = (await client.callTool({
      name: 'submit_acquisition',
      arguments: SUBMIT_BODY,
    })) as { content: { text: string }[] };
    const id = (JSON.parse(call.content[0]!.text) as { acquisitionId: string }).acquisitionId;
    await settle(w, id, 'Fulfilled');

    const resource = await client.readResource({ uri: `md://acquisitions/${id}` });
    const view = JSON.parse((resource.contents[0] as { text: string }).text) as { status: string };
    expect(view.status).toBe('Fulfilled');
  });
});

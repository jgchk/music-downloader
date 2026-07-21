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
import { createHmac } from 'node:crypto';
import { WebhookDispatcher } from '../adapters/webhook/dispatcher.js';
import type { HttpClient, HttpRequest } from '../adapters/support/http.js';
import { WebhookPublisher } from '../application/events/webhook-publisher.js';
import { publishedEventMapping } from '../interfaces/contracts/events/mapping.js';
import type { AcquisitionFulfilledEvent } from '../interfaces/contracts/events/schemas.js';
import { buildHttpApp } from '../interfaces/http/app.js';
import type { HttpAppOptions } from '../interfaces/http/app.js';
import { VERDICT_WEBHOOK_PATH } from '../interfaces/http/verdict-webhook.js';
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
/** Files the source had already completed into staging when a multi-file candidate was abandoned. */
const PARTIAL_FILES = [{ path: 'staging/partial-01.flac', name: '01.flac' }];
const ABANDONED: DownloadResult = { kind: 'failed', reason: 'Stalled', files: PARTIAL_FILES };
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
  const discardStaging = vi.fn((_files) => okAsync<void>(undefined));
  const status = new AcquisitionStatusProjection();
  const progressModel = new ProgressReadModel();
  const libraryView = new LibraryViewProjection();
  bus.subscribe((stored) => {
    status.apply(stored);
    libraryView.apply(stored);
  });

  const ports: EffectPorts = {
    metadata: { resolve: () => okAsync({ kind: 'resolved', target: sampleTarget }) },
    search: { search: (_acquisitionId, _target, round) => okAsync(opts.searchByRound(round)) },
    download: {
      download: (_acquisitionId, candidate, _policy, onProgress) => {
        const result = opts.downloadByUser[candidate.identity.username] ?? FAILED;
        if (result.kind === 'completed') {
          onProgress({ percent: 100, bytesTransferred: 1, bytesTotal: 1 });
        }
        return okAsync(result);
      },
      abort: () => okAsync([]),
    },
    probe: { probe: (path) => okAsync(PROBES[path]!) },
    library: { import: () => okAsync(opts.importResult), discardStaging },
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
  return {
    db,
    store,
    bus,
    checkpoints,
    reactor,
    status,
    progressModel,
    libraryView,
    deps,
    discardStaging,
  };
}

type Wiring = ReturnType<typeof wire>;

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function startHttp(opts: E2eOptions, appOptions: HttpAppOptions = {}) {
  const w = wire(opts);
  await w.reactor.start();
  const app = await buildHttpApp(w.deps, silentLogger(), '0.0.0-test', appOptions);
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

  it('discards an abandoned candidate’s completed subset, keeping its failure reason', async () => {
    const { w, app } = await startHttp({
      searchByRound: (round) =>
        round === 1 ? [candidateWithSpeed('a', 200), candidateWithSpeed('b', 100)] : [],
      downloadByUser: { a: ABANDONED, b: COMPLETED },
      importResult: IMPORTED,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/acquisitions',
      payload: SUBMIT_BODY,
    });
    const id = res.json<{ acquisitionId: string }>().acquisitionId;
    await settle(w, id, 'Fulfilled');

    // The abandoned candidate's already-completed files are discarded from staging — no residue —
    // via the same cleanup path a rejected candidate uses (D2).
    await vi.waitFor(() => {
      expect(w.discardStaging).toHaveBeenCalledWith(PARTIAL_FILES);
    });
    // The abandonment was still recorded as a failure with its reason, not swallowed.
    expect(w.status.get(id)!.history.some((entry) => entry.kind === 'download-failed')).toBe(true);
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
    // The conflicted candidate's staged files must not be left orphaned in staging.
    await vi.waitFor(() => {
      expect(w.discardStaging).toHaveBeenCalledWith(DOWNLOADED_FILES);
    });
  });

  it('announces a fulfilled acquisition to a webhook subscriber — signed, self-contained, and idempotent across redelivery', async () => {
    const SECRET_KEY = Buffer.from('e2e-signing-key-0123456789abcdef');
    const SECRET = `whsec_${SECRET_KEY.toString('base64')}`;
    const SUBSCRIBER = 'https://importer.example/hooks/music';
    const received: HttpRequest[] = [];
    const stubSubscriber: HttpClient = {
      send: (request) => {
        received.push(request);
        return Promise.resolve({ status: 200, body: '' });
      },
    };
    const { w, app } = await startHttp(happyOptions);
    const publisherOf = (checkpoints: Wiring['checkpoints']) =>
      new WebhookPublisher({
        store: w.store,
        bus: w.bus,
        checkpoints,
        logger: silentLogger(),
        mapping: publishedEventMapping,
        deliver: new WebhookDispatcher(silentLogger(), stubSubscriber, fixedClock(), {
          secret: SECRET,
        }),
        subscribers: [SUBSCRIBER],
        retry: { attempts: 1, baseDelayMs: 0 },
        sleep: () => Promise.resolve(),
      });
    const publisher = publisherOf(w.checkpoints);
    await publisher.start();
    cleanups.push(() => publisher.stop());

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/acquisitions',
      payload: SUBMIT_BODY,
    });
    const id = res.json<{ acquisitionId: string }>().acquisitionId;
    await settle(w, id, 'Fulfilled');
    await vi.waitFor(() => {
      expect(received).toHaveLength(1);
    });

    // The Standard Webhooks envelope, signed with the shared secret.
    const delivery = received[0]!;
    expect(delivery.method).toBe('POST');
    expect(delivery.url).toBe(SUBSCRIBER);
    const headers = delivery.headers!;
    const signedContent = `${headers['webhook-id']!}.${headers['webhook-timestamp']!}.${delivery.body!}`;
    const expectedSignature = createHmac('sha256', SECRET_KEY)
      .update(signedContent)
      .digest('base64');
    expect(headers['webhook-signature']).toBe(`v1,${expectedSignature}`);

    // The fat payload: everything a consumer needs to act, no callback required.
    const envelope = JSON.parse(delivery.body!) as AcquisitionFulfilledEvent;
    expect(envelope.type).toBe('acquisition.fulfilled');
    expect(envelope.data.acquisitionId).toBe(id);
    expect(envelope.data.target).toMatchObject({ artist: 'Radiohead', title: 'Kid A' });
    expect(envelope.data.location).toBe(IMPORTED.location);
    expect(envelope.data.files.map((file) => file.name)).toEqual(['01.flac', '02.flac']);
    expect(envelope.data.files[0]!.path).toBe(`${IMPORTED.location}/01.flac`);

    // Simulated redelivery (lost acknowledgement → fresh checkpoints): same idempotency id.
    const redeliverer = publisherOf(new SqliteCheckpointStore(openEventDatabase(':memory:')));
    await redeliverer.start();
    redeliverer.stop();
    expect(received).toHaveLength(2);
    expect(received[1]!.headers!['webhook-id']).toBe(headers['webhook-id']);
    const secondEnvelope = JSON.parse(received[1]!.body!) as AcquisitionFulfilledEvent;
    expect(secondEnvelope).toEqual(envelope);
  });

  it('revives a fulfilled acquisition on a signed external rejection and re-fulfils with the next candidate', async () => {
    const RECEIVER_KEY = Buffer.from('verdict-receiver-key-0123456789ab');
    const RECEIVER_SECRET = `whsec_${RECEIVER_KEY.toString('base64')}`;
    // Two ranked candidates: 'a' wins the first pass; 'b' stays in the retained working set.
    const { w, app } = await startHttp(
      {
        searchByRound: (round) =>
          round === 1 ? [candidateWithSpeed('a', 200), candidateWithSpeed('b', 100)] : [],
        downloadByUser: { a: COMPLETED, b: COMPLETED },
        importResult: IMPORTED,
      },
      { verdictWebhook: { secret: RECEIVER_SECRET } },
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/acquisitions',
      payload: SUBMIT_BODY,
    });
    const id = res.json<{ acquisitionId: string }>().acquisitionId;
    await settle(w, id, 'Fulfilled');
    expect(w.status.get(id)!.attempts).toBe(1);

    const fulfilledIdentity = matchingCandidate('a').identity;
    const verdictBody = JSON.stringify({
      type: 'import.rejected', // sender envelope fields beyond `data` are ignored
      data: {
        acquisitionId: id,
        candidate: fulfilledIdentity,
        verdict: 'rejected',
        reasons: ['corrupt stub'],
      },
    });
    const deliver = (deliveryId: string) => {
      const timestamp = String(Math.floor(fixedClock().now().getTime() / 1000));
      const signature = createHmac('sha256', RECEIVER_KEY)
        .update(`${deliveryId}.${timestamp}.${verdictBody}`)
        .digest('base64');
      return app.inject({
        method: 'POST',
        url: VERDICT_WEBHOOK_PATH,
        headers: {
          'content-type': 'application/json',
          'webhook-id': deliveryId,
          'webhook-timestamp': timestamp,
          'webhook-signature': `v1,${signature}`,
        },
        payload: verdictBody,
      });
    };

    const accepted = await deliver('verdict-1');
    expect(accepted.statusCode).toBe(204);

    // The revival re-enters the existing ladder: candidate 'b' downloads and the acquisition
    // re-fulfils, spending a second attempt.
    await vi.waitFor(() => {
      const view = w.status.get(id)!;
      expect(view.status).toBe('Fulfilled');
      expect(view.attempts).toBe(2);
    });
    const view = w.status.get(id)!;
    expect(view.rejectedCount).toBe(1);
    expect(view.location).toBe(IMPORTED.location);
    expect(
      view.history.some(
        (entry) => entry.kind === 'fulfillment-rejected' && entry.reasons[0] === 'corrupt stub',
      ),
    ).toBe(true);
    const selections = view.history.filter((entry) => entry.kind === 'selected');
    expect(selections.at(-1)!.candidate.username).toBe('b');

    // A duplicate delivery converges: acknowledged, and nothing about the acquisition changes.
    const eventCount = (await w.store.readAll(0))._unsafeUnwrap().length;
    const redelivered = await deliver('verdict-1');
    expect(redelivered.statusCode).toBe(204);
    // A late verdict naming the *first* candidate again is stale against the new fulfilment.
    const stale = await deliver('verdict-2');
    expect(stale.statusCode).toBe(204);
    expect((await w.store.readAll(0))._unsafeUnwrap()).toHaveLength(eventCount);
    expect(w.status.get(id)!.attempts).toBe(2);
  });

  it('fulfills an acquisition submitted over MCP', async () => {
    const w = wire(happyOptions);
    await w.reactor.start();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await buildMcpServer(w.deps, silentLogger(), '0.0.0-test').connect(serverTransport);
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

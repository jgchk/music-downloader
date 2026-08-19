import path from 'node:path';
import { asCandidateIdentity } from '../../domain/shared/__fixtures__/candidate-identity.js';
import { describe, expect, it } from 'vitest';
import { errAsync, okAsync } from 'neverthrow';
import { FakeResourceLedger, silentLogger } from '../../application/__fixtures__/fakes.js';
import { OTHER_STORY, STORY, testContext } from '../../application/__fixtures__/correlation.js';
import type { CommandContext, OperationScope } from '../../application/correlation/context.js';
import type { Candidate, CandidateIdentity } from '../../domain/candidate/candidate.js';
import { createDownloadPolicy } from '../../domain/policy/policies.js';
import type { TryPolicy } from '../../domain/policy/policies.js';
import { infraError } from '../../application/ports/errors.js';
import type {
  TransferObserverPort,
  TransferProgress,
  TryResult,
} from '../../application/ports/outbound-ports.js';
import type { HttpClient, HttpResponse } from '../support/http.js';
import { SlskdClient } from './client.js';
import { ESCALATE_EVERY, SlskdDownload } from './download.js';
import type { Timer } from './timer.js';

const SILENT_SCOPE: OperationScope = { context: testContext(), logger: silentLogger() };

const STAGING = '/staging';
const DOWNLOADS_ROOT = '/downloads';
const ACQ = 'acq-1';
/**
 * The wall-clock the fake clocks below start from. Deliberately NOT zero: every budget the watch
 * enforces is an *elapsed* time measured against `Timer.now()`, which in production is `Date.now()`.
 * A clock whose origin is zero makes "now minus the mark" and "now plus the mark" agree, so the
 * budgets would be pinned only for a clock no deployment ever has.
 */
const CLOCK_EPOCH = 1_770_000_000_000;
/** The two persistent-failure loops' retry lines — asserted often enough to be worth naming. */
const TICK_RETRY = 'download watch tick failed; retrying on the next tick';
const DELIVERY_RETRY = 'download outcome delivery failed; retrying on the watch cadence';
const candidate: Candidate = {
  identity: asCandidateIdentity({ username: 'u1', path: String.raw`@@a\Album`, sizeBytes: 200 }),
  files: [
    { name: '01.flac', sizeBytes: 100 },
    { name: '02.flac', sizeBytes: 100 },
  ],
  source: { speedBytesPerSec: 0, freeSlots: 1, queueLength: 0 },
};

const policy = (stallTimeoutMs: number, maxQueueWaitMs: number): TryPolicy =>
  createDownloadPolicy({ stallTimeoutMs, maxQueueWaitMs })._unsafeUnwrap();

function transfer(name: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: name, filename: `@@a\\Album\\${name}`, ...extra };
}

function poll(files: readonly unknown[]): HttpResponse {
  // Mirror slskd's real per-user download payload: a single object whose transfers hang off
  // `directories`, each group carrying a `files` array (verified against slskd 0.22.5).
  return {
    status: 200,
    body: JSON.stringify({ username: 'u1', directories: [{ directory: 'd', files }] }),
  };
}

interface Completion {
  readonly id: string;
  readonly local: string;
}

/** A page of the slskd events log: one `DownloadFileComplete` record per completion. */
function eventsPage(completions: readonly Completion[]): HttpResponse {
  return {
    status: 200,
    body: JSON.stringify(
      completions.map((completion) => ({
        type: 'DownloadFileComplete',
        data: JSON.stringify({
          localFilename: completion.local,
          transfer: { id: completion.id },
        }),
      })),
    ),
  };
}

/** slskd's downloads-root under its own container path — what `localFilename` is reported against. */
function localOf(name: string, onDisk = name): string {
  return `${DOWNLOADS_ROOT}/Album/${onDisk}`;
}

function optionsResponse(downloads = DOWNLOADS_ROOT): HttpResponse {
  return { status: 200, body: JSON.stringify({ directories: { downloads } }) };
}

/** Where the adapter should report a completed file: slskd's path re-rooted onto STAGING. */
function stagedPath(onDisk: string): string {
  return path.join(STAGING, 'Album', onDisk);
}

function fakeTimer(): Timer {
  let current = CLOCK_EPOCH;
  return {
    now: () => current,
    sleep: (ms) => {
      current += ms;
      return Promise.resolve();
    },
  };
}

/**
 * A timer whose sleeps park until the test ticks them — for watches that must stay in flight
 * while the test body acts (an abort, a second start). The instant {@link fakeTimer} would let
 * a never-settling watch monopolize the microtask queue instead of yielding to the test.
 */
const MICROTASK_YIELDS_PER_TICK = 5;
/** Guard for tick-driven wait loops: a supervisor bug fails fast instead of hanging the suite. */
const MAX_TICKS = 1000;

async function tickUntil(
  control: { tick: () => Promise<void> },
  isDone: () => boolean,
  what: string,
): Promise<void> {
  for (let index = 0; index < MAX_TICKS; index += 1) {
    if (isDone()) return;
    await control.tick();
  }
  throw new Error(`gave up after ${MAX_TICKS} ticks waiting for ${what}`);
}

function manualTimer(): { timer: Timer; tick: () => Promise<void> } {
  let current = CLOCK_EPOCH;
  const waiters: (() => void)[] = [];
  return {
    timer: {
      now: () => current,
      sleep: (ms) =>
        new Promise<void>((resolve) => {
          waiters.push(() => {
            current += ms;
            resolve();
          });
        }),
    },
    tick: async () => {
      waiters.shift()?.();
      // Yield enough microtask turns for the woken watch to run to its next await; the budget is
      // generous, and callers loop `tick()` against an observable condition rather than counting.
      for (let index = 0; index < MICROTASK_YIELDS_PER_TICK; index += 1) await Promise.resolve();
    },
  };
}

const bothSucceeded = poll([
  transfer('01.flac', { state: 'Completed, Succeeded', size: 100, bytesTransferred: 100 }),
  transfer('02.flac', { state: 'Completed, Succeeded', size: 100, bytesTransferred: 100 }),
]);

const bothCompleted = eventsPage([
  { id: '01.flac', local: localOf('01.flac') },
  { id: '02.flac', local: localOf('02.flac') },
]);

const emptyEvents = eventsPage([]);

interface Options {
  enqueue?: HttpResponse;
  /** Per-POST gates, in order; an undefined slot falls through to the default response. */
  enqueueGates?: (Promise<HttpResponse> | undefined)[];
  /** Per-transfers-GET gates, in order; an undefined slot falls through to the polls queue. */
  pollGates?: (Promise<HttpResponse> | undefined)[];
  enqueueThrows?: boolean; // transport-level failure: slskd itself unreachable
  polls: HttpResponse[];
  events?: HttpResponse[];
  options?: HttpResponse[];
  deleteStatus?: number; // status returned for record-removal DELETEs (default 204)
  deleteThrows?: boolean; // transport-level failure on record-removal DELETEs
  deliverFailures?: number; // the first N outcome deliveries fail with an InfraError
  deliverThrows?: boolean; // the observer itself throws (a consumer bug, not a modeled Err)
  finishedThrows?: boolean; // the observer's finished() hook throws (cleanup containment)
  timer?: Timer;
}

interface Delivered {
  readonly acquisitionId: string;
  readonly candidate: CandidateIdentity;
  readonly result: TryResult;
  readonly context: CommandContext;
}

interface Harness {
  adapter: SlskdDownload;
  scope: OperationScope;
  deletes: string[];
  ledger: FakeResourceLedger;
  counts: { options: number; events: number; posts: number; deliveries: number; polls: number };
  outcomes: Delivered[];
  progress: TransferProgress[];
  finished: string[];
  errorLogs: string[];
  /** Pushed in lockstep with {@link Harness.errorLogs}, so an index found in one indexes the other. */
  errorContexts: Record<string, unknown>[];
  warnLogs: string[];
  warnContexts: Record<string, unknown>[];
}

function drain(queue: HttpResponse[], fallback: HttpResponse): HttpResponse {
  return (queue.length > 1 ? queue.shift() : queue[0]) ?? fallback;
}

function downloader(options: Options): Harness {
  const deletes: string[] = [];
  const ledger = new FakeResourceLedger();
  const counts = { options: 0, events: 0, posts: 0, deliveries: 0, polls: 0 };
  const outcomes: Delivered[] = [];
  const progress: TransferProgress[] = [];
  const finished: string[] = [];
  const errorLogs: string[] = [];
  const errorContexts: Record<string, unknown>[] = [];
  const warnLogs: string[] = [];
  const warnContexts: Record<string, unknown>[] = [];
  const polls = [...options.polls];
  // Default to a page that resolves the candidate's two transfers, so a succeeded outcome reports
  // its staged files without every test having to spell out the events stub.
  const events = [...(options.events ?? [bothCompleted])];
  const optionsQueue = [...(options.options ?? [optionsResponse()])];
  let deliverFailures = options.deliverFailures ?? 0;
  const http: HttpClient = {
    send: ({ method, url }) => {
      if (method === 'POST') {
        counts.posts += 1;
        if (options.enqueueThrows) return Promise.reject(new Error('socket hang up'));
        const gate = options.enqueueGates?.shift();
        if (gate !== undefined) return gate;
        return Promise.resolve(options.enqueue ?? { status: 200, body: '' });
      }
      if (method === 'DELETE') {
        deletes.push(url);
        if (options.deleteThrows) return Promise.reject(new Error('socket hang up'));
        return Promise.resolve({ status: options.deleteStatus ?? 204, body: '' });
      }
      if (url.includes('/api/v0/options')) {
        counts.options += 1;
        return Promise.resolve(drain(optionsQueue, optionsResponse()));
      }
      if (url.includes('/api/v0/events')) {
        counts.events += 1;
        return Promise.resolve(drain(events, emptyEvents));
      }
      counts.polls += 1;
      const pollGate = options.pollGates?.shift();
      if (pollGate !== undefined) return pollGate;
      return Promise.resolve(drain(polls, { status: 200, body: '{"directories":[]}' }));
    },
  };
  const observer: TransferObserverPort = {
    progress: (_acquisitionId, snapshot) => {
      progress.push(snapshot);
    },
    outcome: (acquisitionId, delivered, result, context) => {
      counts.deliveries += 1;
      if (options.deliverThrows) throw new Error('observer bug: exploded before returning');
      if (deliverFailures > 0) {
        deliverFailures -= 1;
        return errAsync(infraError('outcome.deliver', 'store busy'));
      }
      outcomes.push({ acquisitionId, candidate: delivered, result, context });
      return okAsync(undefined);
    },
    finished: (acquisitionId) => {
      if (options.finishedThrows) throw new Error('observer bug: finished exploded');
      finished.push(acquisitionId);
    },
  };
  const recordingLogger = {
    ...silentLogger(),
    warn: (context: unknown, message?: string) => {
      warnLogs.push(message ?? '');
      warnContexts.push(context as Record<string, unknown>);
    },
    error: (context: unknown, message?: string) => {
      errorLogs.push(message ?? '');
      errorContexts.push(context as Record<string, unknown>);
    },
  };
  const adapter = new SlskdDownload(
    recordingLogger,
    ledger,
    { stagingRoot: STAGING, pollIntervalMs: 100 },
    observer,
    new SlskdClient(http),
    options.timer ?? fakeTimer(),
  );
  // The scope the shell would hand this effect: its logger IS the harness's recording logger, so
  // watch-scoped lines stay observable exactly where they were before the scope existed.
  const scope: OperationScope = { context: testContext(), logger: recordingLogger };
  return {
    adapter,
    scope,
    deletes,
    ledger,
    counts,
    outcomes,
    progress,
    finished,
    errorLogs,
    errorContexts,
    warnLogs,
    warnContexts,
  };
}

/** Start the candidate and drive the watch to its delivered outcome (the common happy shape). */
async function run(
  harness: Harness,
  downloadPolicy: TryPolicy = policy(1000, 1000),
): Promise<TryResult> {
  const started = await harness.adapter.start(ACQ, candidate, downloadPolicy, harness.scope);
  expect(started._unsafeUnwrap()).toEqual({ kind: 'started' });
  await harness.adapter.settled();
  expect(harness.outcomes).toHaveLength(1);
  return harness.outcomes[0]!.result;
}

describe('SlskdDownload', () => {
  it('reports a completed multi-file candidate at the slskd-reported on-disk location', async () => {
    const harness = downloader({
      polls: [
        poll([
          transfer('01.flac', { state: 'Completed, Succeeded', size: 100, bytesTransferred: 100 }),
          transfer('02.flac', { state: 'Completed, Succeeded', size: 100, bytesTransferred: 100 }),
          { state: 'InProgress' }, // an unrelated transfer with no filename is ignored
        ]),
      ],
      events: [bothCompleted],
    });

    const result = await run(harness);

    expect(result).toEqual({
      kind: 'completed',
      files: [
        { name: '01.flac', path: stagedPath('01.flac') },
        { name: '02.flac', path: stagedPath('02.flac') },
      ],
    });
    expect(harness.progress.at(-1)?.percent).toBe(100);
    expect(harness.finished).toEqual([ACQ]); // the watch retired its live progress
  });

  it('keeps the clean candidate name while pointing at slskd’s renamed on-disk file', async () => {
    // slskd sanitized/de-duplicated 01.flac to 01_123456.flac; the event carries the real name.
    const harness = downloader({
      polls: [bothSucceeded],
      events: [
        eventsPage([
          { id: '01.flac', local: localOf('01.flac', '01_123456.flac') },
          { id: '02.flac', local: localOf('02.flac') },
        ]),
      ],
    });

    const result = await run(harness);

    expect(result).toEqual({
      kind: 'completed',
      files: [
        { name: '01.flac', path: stagedPath('01_123456.flac') },
        { name: '02.flac', path: stagedPath('02.flac') },
      ],
    });
  });

  it('pages older events until every completed transfer id resolves', async () => {
    const harness = downloader({
      polls: [bothSucceeded],
      events: [
        eventsPage([{ id: '01.flac', local: localOf('01.flac') }]), // offset 0 — only one of ours
        eventsPage([{ id: '02.flac', local: localOf('02.flac') }]), // offset 100 — the other
      ],
    });

    const result = await run(harness);

    expect(result.kind).toBe('completed');
    expect(harness.counts.events).toBe(2);
  });

  it('re-polls the events log when a completion event lags the transfer-state flip', async () => {
    const harness = downloader({
      polls: [bothSucceeded],
      events: [emptyEvents, bothCompleted], // empty on first poll, complete on the next
    });

    const result = await run(harness);

    expect(result.kind).toBe('completed');
    expect(harness.counts.events).toBe(2);
  });

  it('keeps retrying the settle when the events log lags past the resolver’s budget', async () => {
    // Attempt 1 exhausts the resolver's five bounded re-polls on empty pages and throws; the
    // watch logs, sleeps, and retries the settle — attempt 2 then finds the completions. The
    // watch is self-healing: a lagging log delays the outcome, it never loses it.
    const harness = downloader({
      polls: [bothSucceeded],
      events: [emptyEvents, emptyEvents, emptyEvents, emptyEvents, emptyEvents, bothCompleted],
    });

    const result = await run(harness);

    expect(result.kind).toBe('completed');
    expect(harness.counts.events).toBe(6);
  });

  it('reads the downloads root once and caches it across downloads', async () => {
    const harness = downloader({ polls: [bothSucceeded], events: [bothCompleted] });

    await run(harness);
    const again = await harness.adapter.start(ACQ, candidate, policy(1000, 1000), harness.scope);
    expect(again._unsafeUnwrap()).toEqual({ kind: 'started' });
    await harness.adapter.settled();

    expect(harness.counts.options).toBe(1);
    expect(harness.outcomes).toHaveLength(2);
  });

  it('retries the settle when the options body violates the contract, then heals', async () => {
    const harness = downloader({
      polls: [bothSucceeded],
      events: [bothCompleted],
      options: [{ status: 200, body: JSON.stringify({ directories: {} }) }, optionsResponse()],
    });

    const result = await run(harness);

    expect(result.kind).toBe('completed');
    expect(harness.counts.options).toBe(2); // the bad body was not cached
  });

  it('fails the whole candidate when a file does not transfer', async () => {
    const harness = downloader({
      polls: [
        poll([
          transfer('01.flac', { state: 'Completed, Succeeded', size: 100, bytesTransferred: 100 }),
          transfer('02.flac', { state: 'Completed, Errored', size: 100, bytesTransferred: 40 }),
        ]),
      ],
    });

    const result = await run(harness);

    // 01 completed before the doom, so its staged path is surfaced for cleanup (default events stub).
    expect(result).toEqual({
      kind: 'failed',
      reason: 'TransferError',
      files: [{ name: '01.flac', path: stagedPath('01.flac') }],
    });
  });

  it('normalizes an offline peer to a peer-unavailable outcome', async () => {
    const harness = downloader({
      polls: [
        poll([
          transfer('01.flac', {
            state: 'Completed, Errored',
            exception: 'User peer1 appears to be offline',
          }),
          transfer('02.flac', {
            state: 'Completed, Errored',
            exception: 'User peer1 appears to be offline',
          }),
        ]),
      ],
    });

    const result = await run(harness);

    // Neither file completed, so there is nothing staged to clean up.
    expect(result).toEqual({
      kind: 'failed',
      reason: 'PeerUnavailable',
      files: [],
    });
  });

  it('abandons a stalled transfer, cancelling then confirming its records removed', async () => {
    const inFlight = poll([
      transfer('01.flac', { state: 'InProgress', size: 100, bytesTransferred: 50 }),
      transfer('02.flac', { state: 'InProgress', size: 100, bytesTransferred: 0 }),
    ]);
    const cancelled = poll([
      transfer('01.flac', { state: 'Completed, Cancelled' }),
      transfer('02.flac', { state: 'Completed, Cancelled' }),
      { id: 'foreign', filename: String.raw`@@a\Other\9.flac`, state: 'InProgress' }, // another candidate
      { id: 'nameless', state: 'InProgress' }, // a transfer with no filename
    ]);
    const harness = downloader({
      // Two identical in-flight polls advance the clock to the stall; the teardown then re-polls a
      // cancelled-terminal set, and a final empty poll confirms the records are gone.
      polls: [inFlight, inFlight, cancelled, poll([])],
    });

    const result = await run(harness, policy(50, 100_000));

    expect(result).toEqual({ kind: 'failed', reason: 'Stalled', files: [] });
    // Each transfer is cancelled (remove=false), then removed once terminal (remove=true).
    expect(harness.deletes).toEqual([
      'http://localhost:5030/api/v0/transfers/downloads/u1/01.flac?remove=false',
      'http://localhost:5030/api/v0/transfers/downloads/u1/02.flac?remove=false',
      'http://localhost:5030/api/v0/transfers/downloads/u1/01.flac?remove=true',
      'http://localhost:5030/api/v0/transfers/downloads/u1/02.flac?remove=true',
    ]);
    expect(harness.ledger.removed).toHaveLength(2); // both confirmed gone
  });

  describe('reconcile-before-enqueue (reactor-durability D3)', () => {
    /**
     * The prior attempt's write-ahead rows, as a crashed poller would have left them. The
     * resourceKey follows TransferLedger.keyFor's `${username}|${remoteFilename}` contract —
     * drifting from it makes the rows invisible to reconciliation (posts would become 1).
     */
    function seedLedgeredTransfers(ledger: FakeResourceLedger): void {
      for (const name of ['01.flac', '02.flac']) {
        ledger.created.push({
          source: 'slskd',
          kind: 'transfer',
          resourceKey: `u1|@@a\\Album\\${name}`,
          acquisitionId: ACQ,
        });
      }
    }

    const inFlight = poll([
      transfer('01.flac', { state: 'InProgress', size: 100, bytesTransferred: 50 }),
      transfer('02.flac', { state: 'InProgress', size: 100, bytesTransferred: 50 }),
    ]);

    it('re-attaches to live ledgered transfers instead of downloading a second time', async () => {
      const harness = downloader({ polls: [inFlight, bothSucceeded], events: [bothCompleted] });
      seedLedgeredTransfers(harness.ledger);

      const result = await run(harness);

      expect(result.kind).toBe('completed');
      expect(harness.counts.posts).toBe(0); // never enqueued again — polling resumed
    });

    it('re-emits the outcome straight away when the source already settled the transfers', async () => {
      // The boot re-derivation shape (level-triggered): the process died between the transfers
      // settling and the outcome being recorded. Starting again re-attaches to the settled
      // records and delivers the outcome on the first tick — no second download.
      const harness = downloader({ polls: [bothSucceeded], events: [bothCompleted] });
      seedLedgeredTransfers(harness.ledger);

      const result = await run(harness);

      expect(result.kind).toBe('completed');
      expect(harness.counts.posts).toBe(0);
    });

    it('re-enqueues when the source retains only a subset of the ledgered transfers', async () => {
      // Resuming over a partial survival would settle the poll over the present file alone and
      // report an under-delivered candidate as completed — a partial must re-enqueue instead.
      const onlyFirst = poll([
        transfer('01.flac', { state: 'InProgress', size: 100, bytesTransferred: 50 }),
      ]);
      const harness = downloader({ polls: [onlyFirst, bothSucceeded], events: [bothCompleted] });
      seedLedgeredTransfers(harness.ledger);

      const result = await run(harness);

      expect(result.kind).toBe('completed');
      expect(harness.counts.posts).toBe(1);
    });

    it('re-enqueues when the ledgered transfers were lost at the source', async () => {
      const harness = downloader({ polls: [poll([]), bothSucceeded], events: [bothCompleted] });
      seedLedgeredTransfers(harness.ledger);

      const result = await run(harness);

      expect(result.kind).toBe('completed');
      expect(harness.counts.posts).toBe(1);
    });

    it('applies the queue-wait budget from re-attach — a resumed transfer can still time out', async () => {
      const queued = poll([
        transfer('01.flac', { state: 'Queued, Remotely', size: 100, placeInQueue: 4 }),
        transfer('02.flac', { state: 'Queued, Remotely', size: 100 }),
      ]);
      const harness = downloader({ polls: [queued, queued, queued, poll([])] });
      seedLedgeredTransfers(harness.ledger);

      const result = await run(harness, policy(100_000, 50));

      expect(result).toEqual({ kind: 'failed', reason: 'QueueTimeout', files: [] });
      expect(harness.counts.posts).toBe(0);
    });

    it('a fresh download consults no listing before its enqueue (no prior ledger rows)', async () => {
      const harness = downloader({ polls: [bothSucceeded], events: [bothCompleted] });

      const result = await run(harness);

      expect(result.kind).toBe('completed');
      expect(harness.counts.posts).toBe(1);
    });

    it('degrades to a plain enqueue when the ledger cannot be read', async () => {
      const harness = downloader({ polls: [bothSucceeded], events: [bothCompleted] });
      seedLedgeredTransfers(harness.ledger);
      harness.ledger.fail = true;

      const result = await run(harness);

      expect(result.kind).toBe('completed');
      expect(harness.counts.posts).toBe(1);
    });
  });

  it('abandons a hopelessly-queued transfer once the queue wait elapses', async () => {
    const queued = poll([
      transfer('01.flac', { state: 'Queued, Remotely', size: 100, placeInQueue: 4 }),
      { filename: String.raw`@@a\Album\02.flac`, state: 'Queued, Remotely', size: 100 }, // no id
    ]);
    const harness = downloader({
      // Two identical queued polls advance the clock past the queue wait; the teardown then finds
      // the cancelled transfers already gone on its re-poll.
      polls: [queued, queued, poll([])],
    });

    const result = await run(harness, policy(100_000, 50));

    expect(result).toEqual({ kind: 'failed', reason: 'QueueTimeout', files: [] });
    // Both queued (non-terminal) transfers are cancelled; the re-poll then finds them gone.
    expect(harness.deletes).toEqual([
      'http://localhost:5030/api/v0/transfers/downloads/u1/01.flac?remove=false',
      'http://localhost:5030/api/v0/transfers/downloads/u1/?remove=false',
    ]);
    expect(harness.ledger.removed).toHaveLength(2);
    // Ids are attached as slskd first reports them: the transfer it has not named yet is left for a
    // later tick, and the one already ledgered is not re-recorded on every poll.
    expect(harness.ledger.ids.map((entry) => entry.id)).toEqual(['01.flac']);
  });

  it('keeps a transfer alive as long as it keeps moving bytes', async () => {
    // The stall budget measures time since the LAST progress, not since the watch began: a slow
    // download that keeps delivering bytes must never be abandoned, however long it runs. Here the
    // candidate spends three poll intervals — twice the budget — transferring steadily.
    const moved = (bytes: number): HttpResponse =>
      poll([
        transfer('01.flac', { state: 'InProgress', size: 100, bytesTransferred: bytes }),
        transfer('02.flac', { state: 'InProgress', size: 100, bytesTransferred: 0 }),
      ]);
    const harness = downloader({
      polls: [moved(10), moved(20), moved(30), bothSucceeded],
      events: [bothCompleted],
    });

    const result = await run(harness, policy(150, 100_000));

    expect(result.kind).toBe('completed');
  });

  it('abandons a queued transfer the moment the queue budget is exactly spent', async () => {
    // The budget is spent when the wait *reaches* it. The third listing shows the transfers running
    // — it is what teardown re-polls to confirm removal, and what a budget firing a tick late would
    // have settled on instead, turning a hopeless queue into a spurious completion.
    const queued = poll([
      transfer('01.flac', { state: 'Queued, Remotely', size: 100 }),
      transfer('02.flac', { state: 'Queued, Remotely', size: 100 }),
    ]);
    const harness = downloader({ polls: [queued, queued, bothSucceeded] });

    const result = await run(harness, policy(100_000, 100));

    expect(result).toEqual({ kind: 'failed', reason: 'QueueTimeout', files: [] });
  });

  it('abandons a transfer the moment the stall budget is exactly spent', async () => {
    // Same boundary on the stall side: two listings carrying identical byte counts one poll
    // interval apart is exactly the budget's worth of silence, and that settles it.
    const inFlight = poll([
      transfer('01.flac', { state: 'InProgress', size: 100, bytesTransferred: 50 }),
      transfer('02.flac', { state: 'InProgress', size: 100, bytesTransferred: 50 }),
    ]);
    const harness = downloader({ polls: [inFlight, inFlight, bothSucceeded] });

    const result = await run(harness, policy(100, 100_000));

    expect(result).toEqual({ kind: 'failed', reason: 'Stalled', files: [] });
  });

  it('surfaces live progress while transferring and completes on the next poll', async () => {
    const harness = downloader({
      polls: [
        poll([
          transfer('01.flac', {
            state: 'InProgress',
            size: 100,
            bytesTransferred: 50,
            placeInQueue: 3,
          }),
          transfer('02.flac', { state: 'InProgress', size: 100, bytesTransferred: 0 }),
        ]),
        bothSucceeded,
      ],
      events: [bothCompleted],
    });

    const result = await run(harness, policy(100_000, 100_000));

    expect(result.kind).toBe('completed');
    expect(harness.progress[0]).toMatchObject({ percent: 25, queuePosition: 3 });
    expect(harness.progress.at(-1)?.percent).toBe(100);
  });

  it('falls back to the default one-second poll interval when unconfigured', async () => {
    // Two-poll scenario so the watch actually sleeps between ticks; the recording timer proves
    // the default cadence rather than merely executing the fallback branch.
    const inFlight = poll([
      transfer('01.flac', { state: 'InProgress', size: 100, bytesTransferred: 50 }),
      transfer('02.flac', { state: 'InProgress', size: 100, bytesTransferred: 50 }),
    ]);
    const polls = [inFlight, bothSucceeded];
    const sleeps: number[] = [];
    let current = 0;
    const recordingTimer: Timer = {
      now: () => current,
      sleep: (ms) => {
        sleeps.push(ms);
        current += ms;
        return Promise.resolve();
      },
    };
    const outcomes: TryResult[] = [];
    const http: HttpClient = {
      send: ({ method, url }) => {
        if (method === 'POST') return Promise.resolve({ status: 200, body: '' });
        if (method === 'DELETE') return Promise.resolve({ status: 204, body: '' });
        if (url.includes('/api/v0/options')) return Promise.resolve(optionsResponse());
        if (url.includes('/api/v0/events')) return Promise.resolve(bothCompleted);
        return Promise.resolve(drain(polls, poll([])));
      },
    };
    const adapter = new SlskdDownload(
      silentLogger(),
      new FakeResourceLedger(),
      { stagingRoot: STAGING },
      {
        progress: () => {},
        outcome: (_acquisitionId, _candidate, result) => {
          outcomes.push(result);
          return okAsync(undefined);
        },
        finished: () => {},
      },
      new SlskdClient(http),
      recordingTimer,
    );

    const started = await adapter.start(ACQ, candidate, policy(100_000, 100_000), SILENT_SCOPE);
    expect(started._unsafeUnwrap()).toEqual({ kind: 'started' });
    await adapter.settled();

    expect(outcomes[0]?.kind).toBe('completed');
    expect(sleeps).toContain(1000); // DEFAULT_POLL_INTERVAL_MS drove the inter-tick sleep
  });

  it('rejects the candidate when slskd answers a 4xx refusal naming an unreachable peer', async () => {
    const harness = downloader({
      enqueue: {
        status: 400,
        body: 'Failed to establish a direct or indirect message connection to user',
      },
      polls: [],
    });

    const started = await harness.adapter.start(ACQ, candidate, policy(1000, 1000), harness.scope);

    // slskd answered with a 4xx, so the infrastructure is up: the candidate failed, and the retry
    // ladder advances to the next peer instead of retrying this one forever (prod 2026-07-22).
    // The rejection is start's own synchronous answer — no watch, no outcome delivery.
    expect(started._unsafeUnwrap()).toEqual({ kind: 'rejected', reason: 'PeerUnavailable' });
    await harness.adapter.settled();
    expect(harness.outcomes).toEqual([]);
    // the write-ahead rows are released: nothing was created at the source
    expect(harness.ledger.removed).toHaveLength(candidate.files.length);
  });

  it('rejects the candidate as a generic transfer error for other enqueue refusals', async () => {
    const harness = downloader({ enqueue: { status: 400, body: 'boom' }, polls: [] });

    const started = await harness.adapter.start(ACQ, candidate, policy(1000, 1000), harness.scope);

    expect(started._unsafeUnwrap()).toEqual({ kind: 'rejected', reason: 'TransferError' });
  });

  // The enqueue is accepted only inside the 2xx window, closed at BOTH ends. Anything else means
  // slskd did not take the request, so watching for transfers it never created would hang the
  // candidate on a queue budget instead of advancing the ladder.
  it.each([199, 300])(
    'treats HTTP %i on the enqueue as a refusal, not an acceptance',
    async (status) => {
      const harness = downloader({ enqueue: { status, body: 'not an acceptance' }, polls: [] });

      const started = await harness.adapter.start(
        ACQ,
        candidate,
        policy(1000, 1000),
        harness.scope,
      );

      expect(started._unsafeUnwrap()).toEqual({ kind: 'rejected', reason: 'TransferError' });
      expect(harness.counts.polls).toBe(0); // no watch was registered to poll for them
    },
  );

  it('surfaces a 5xx enqueue response as a retryable InfraError, not a candidate defeat', async () => {
    // A 503 is slskd itself faulting/overloaded — transient infrastructure. Marking it a candidate
    // failure would manufacture DownloadExhausted from a passing slskd hiccup; the reactor must
    // hold and retry the short start effect instead.
    const harness = downloader({
      enqueue: { status: 503, body: 'Service Unavailable' },
      polls: [],
    });

    const started = await harness.adapter.start(ACQ, candidate, policy(1000, 1000), harness.scope);

    const infraError = started._unsafeUnwrapErr();
    expect(infraError).toMatchObject({
      kind: 'InfraError',
      operation: 'slskd.download',
    });
    // The durable observable of the redaction decision: this message lands in parked-effect
    // lastError fields and dead-letter payloads, where structured redaction cannot reach.
    expect(infraError.message).not.toContain('u1');
    // The operator-facing half of the known-incomplete 5xx routing: slskd's own health speaking
    // reads as `unrecognised`, which is exactly how it is told apart from a dead peer. The raw body
    // is never logged — it can embed the peer's chosen username verbatim.
    const warned = harness.warnContexts.at(-1)!;
    expect(warned).toMatchObject({ status: 503, wouldBe: 'unrecognised' });
    expect(JSON.stringify(warned)).not.toContain('Service Unavailable');
  });

  it('names the peer failure a 5xx enqueue body describes, so a parked download is diagnosable', async () => {
    // A dead peer and an overloaded slskd both come back as a 5xx and are both retried; the only
    // thing telling an operator which they are looking at is this field.
    const harness = downloader({
      enqueue: { status: 500, body: 'User u1 appears to be offline' },
      polls: [],
    });

    await harness.adapter.start(ACQ, candidate, policy(1000, 1000), harness.scope);

    expect(harness.warnContexts.at(-1)).toMatchObject({
      status: 500,
      wouldBe: 'PeerUnavailable',
    });
  });

  it('surfaces a 429 enqueue response as a retryable InfraError', async () => {
    const harness = downloader({
      enqueue: { status: 429, body: 'Too Many Requests' },
      polls: [],
    });

    const started = await harness.adapter.start(ACQ, candidate, policy(1000, 1000), harness.scope);

    // Throttling is slskd's own health, not a peer verdict — classifying its body would invite an
    // operator to read a peer failure into it, so no `wouldBe` is offered at all.
    expect(harness.warnContexts.at(-1)).not.toHaveProperty('wouldBe');

    expect(started._unsafeUnwrapErr()).toMatchObject({
      kind: 'InfraError',
      operation: 'slskd.download',
    });
  });

  it('surfaces a transport fault during enqueue as an InfraError (slskd itself unreachable)', async () => {
    const harness = downloader({ enqueueThrows: true, polls: [] });

    const started = await harness.adapter.start(ACQ, candidate, policy(1000, 1000), harness.scope);

    expect(started._unsafeUnwrapErr()).toMatchObject({
      kind: 'InfraError',
      operation: 'slskd.download',
    });
  });

  it('treats a 404 mid-download poll as vanished transfers and stalls out, not an infra fault', async () => {
    const harness = downloader({ polls: [{ status: 404, body: '' }] });

    const result = await run(harness, policy(200, 1000));

    expect(result).toMatchObject({ kind: 'failed', reason: 'Stalled' });
  });

  it('retries a contract-violating poll body on the next tick instead of dying (self-healing)', async () => {
    const harness = downloader({
      polls: [
        { status: 200, body: JSON.stringify({ directories: 'not-an-array' }) },
        bothSucceeded,
      ],
      events: [bothCompleted],
    });

    const result = await run(harness);

    expect(result.kind).toBe('completed');
    // A one-tick blip is a warn; escalation to error is reserved for a run of failures, so an
    // operator scanning errors sees wedges only.
    expect(harness.warnLogs).toContain(TICK_RETRY);
    expect(harness.errorLogs).not.toContain(TICK_RETRY);
  });

  it('starting an already-watched candidate is an idempotent no-op (level-triggered ensure)', async () => {
    const control = manualTimer();
    const inFlight = poll([
      transfer('01.flac', { state: 'InProgress', size: 100, bytesTransferred: 50 }),
      transfer('02.flac', { state: 'InProgress', size: 100, bytesTransferred: 50 }),
    ]);
    const harness = downloader({
      polls: [inFlight, bothSucceeded, poll([])], // the final empty poll confirms the teardown
      events: [bothCompleted],
      timer: control.timer,
    });

    const first = await harness.adapter.start(
      ACQ,
      candidate,
      policy(100_000, 100_000),
      harness.scope,
    );
    expect(first._unsafeUnwrap()).toEqual({ kind: 'started' });
    // The ensure re-dispatch (a TryStarted reaction, or a redelivery): no second enqueue,
    // no second watch — the live watch is the answer.
    const second = await harness.adapter.start(
      ACQ,
      candidate,
      policy(100_000, 100_000),
      harness.scope,
    );
    expect(second._unsafeUnwrap()).toEqual({ kind: 'started' });
    expect(harness.counts.posts).toBe(1);

    // Wake the parked watch and keep ticking through the settle's own waits until it delivers.
    await tickUntil(control, () => harness.outcomes.length > 0, 'the outcome to deliver');
    await harness.adapter.settled();
    expect(harness.outcomes).toHaveLength(1);
  });

  it('stops retrying delivery once the candidate is aborted (the abort owns the settlement)', async () => {
    const control = manualTimer();
    const harness = downloader({
      polls: [bothSucceeded, poll([])],
      deliverFailures: 99, // delivery never lands; only the abort can end the watch
      timer: control.timer,
    });

    const started = await harness.adapter.start(ACQ, candidate, policy(1000, 1000), harness.scope);
    expect(started._unsafeUnwrap()).toEqual({ kind: 'started' });
    await tickUntil(control, () => harness.counts.deliveries > 0, 'the first delivery attempt');

    const aborted = await harness.adapter.abort(ACQ, candidate, harness.scope);
    expect(aborted._unsafeUnwrap()).toEqual([]);

    await tickUntil(control, () => harness.finished.length > 0, 'the aborted watch to exit');
    await harness.adapter.settled();
    expect(harness.outcomes).toEqual([]); // no outcome was ever delivered for the aborted watch
  });

  it('retries a failed outcome delivery on the watch cadence until it lands, exactly once', async () => {
    const harness = downloader({
      polls: [bothSucceeded],
      events: [bothCompleted],
      deliverFailures: 1,
    });

    const result = await run(harness);

    expect(result.kind).toBe('completed');
    expect(harness.counts.deliveries).toBe(2); // one failed attempt, one landed — never a duplicate
    expect(harness.outcomes).toHaveLength(1);
    // A single missed delivery is a warn — an undeliverable outcome only becomes an error once it
    // persists, so the error stream stays a list of things actually stuck.
    expect(harness.warnLogs).toContain(DELIVERY_RETRY);
    expect(harness.errorLogs).not.toContain(DELIVERY_RETRY);
  });

  it('records transfers write-ahead, captures their ids, and removes records on completion', async () => {
    const harness = downloader({
      polls: [bothSucceeded],
      events: [bothCompleted],
    });

    const result = await run(harness);

    expect(result.kind).toBe('completed');
    expect(harness.ledger.created.map((r) => r.resourceKey)).toEqual([
      String.raw`u1|@@a\Album\01.flac`,
      String.raw`u1|@@a\Album\02.flac`,
    ]);
    expect(harness.ledger.ids.map((entry) => entry.id)).toEqual(['01.flac', '02.flac']);
    expect(harness.deletes).toEqual([
      'http://localhost:5030/api/v0/transfers/downloads/u1/01.flac?remove=true',
      'http://localhost:5030/api/v0/transfers/downloads/u1/02.flac?remove=true',
    ]);
    expect(harness.ledger.removed).toHaveLength(2);
    // Every ledger write landed, so nothing was reported as a stewardship fault.
    expect(harness.warnLogs.filter((message) => message.startsWith('ledger:'))).toEqual([]);
  });

  it('dooms the candidate and cancels the remainder the moment one file fails', async () => {
    const harness = downloader({
      polls: [
        poll([
          transfer('01.flac', { state: 'Completed, Errored', size: 100, bytesTransferred: 0 }),
          transfer('02.flac', { state: 'InProgress', size: 100, bytesTransferred: 30 }),
        ]),
        // The teardown re-poll: the failed file is already gone; the cancelled one is now terminal.
        poll([transfer('02.flac', { state: 'Completed, Cancelled' })]),
        poll([]),
      ],
    });

    // Generous policy timeouts: the failure — not a stall — is what ends the download.
    const result = await run(harness, policy(100_000, 100_000));

    // Neither file succeeded, so there is no partial subset to clean.
    expect(result).toEqual({ kind: 'failed', reason: 'TransferError', files: [] });
    // The failed file (terminal) is removed at once; the in-flight one is cancelled then removed.
    expect(harness.deletes).toEqual([
      'http://localhost:5030/api/v0/transfers/downloads/u1/01.flac?remove=true',
      'http://localhost:5030/api/v0/transfers/downloads/u1/02.flac?remove=false',
      'http://localhost:5030/api/v0/transfers/downloads/u1/02.flac?remove=true',
    ]);
    expect(harness.ledger.removed).toHaveLength(2);
  });

  it('leaves a row live when a cancelled transfer never turns removable', async () => {
    // A single in-flight poll that never settles: every re-poll sees the same non-terminal state.
    const inFlight = poll([
      transfer('01.flac', { state: 'InProgress', size: 100, bytesTransferred: 50 }),
      transfer('02.flac', { state: 'InProgress', size: 100, bytesTransferred: 0 }),
    ]);
    const harness = downloader({ polls: [inFlight] });

    const result = await run(harness, policy(50, 100_000));

    expect(result).toEqual({ kind: 'failed', reason: 'Stalled', files: [] });
    // Cancelled each round but never confirmed terminal, so no row is marked removed — the startup
    // sweep converges them next boot. Only cancels (remove=false) are ever issued, and only for the
    // bounded number of rounds: teardown gives the transition three tries, not an open-ended wait.
    expect(harness.deletes.every((url) => url.endsWith('?remove=false'))).toBe(true);
    expect(harness.deletes).toHaveLength(6); // two transfers × three rounds
    expect(harness.ledger.removed).toHaveLength(0);
  });

  it('reports the completed subset when a candidate is doomed mid-download', async () => {
    const harness = downloader({
      polls: [
        poll([
          transfer('01.flac', { state: 'Completed, Succeeded', size: 100, bytesTransferred: 100 }),
          transfer('02.flac', { state: 'Completed, Errored', size: 100, bytesTransferred: 0 }),
        ]),
        poll([]),
      ],
      events: [eventsPage([{ id: '01.flac', local: localOf('01.flac') }])],
    });

    const result = await run(harness, policy(100_000, 100_000));

    // The already-staged file is surfaced for cleanup; the reported reason is the original failure.
    expect(result).toEqual({
      kind: 'failed',
      reason: 'TransferError',
      files: [{ name: '01.flac', path: stagedPath('01.flac') }],
    });
  });

  it('still fails without files when the completed subset cannot be resolved (best-effort)', async () => {
    const harness = downloader({
      polls: [
        poll([
          transfer('01.flac', { state: 'Completed, Succeeded', size: 100, bytesTransferred: 100 }),
          transfer('02.flac', { state: 'Completed, Errored', size: 100, bytesTransferred: 0 }),
        ]),
        poll([]),
      ],
      events: [emptyEvents], // the events log never reports the completed file's location
    });

    const result = await run(harness, policy(100_000, 100_000));

    // Resolution failing does not turn the doomed failure into an infra fault — just no files.
    expect(result).toEqual({
      kind: 'failed',
      reason: 'TransferError',
      files: [],
    });
  });

  it('skips a completed file whose transfer id was never captured', async () => {
    const harness = downloader({
      polls: [
        poll([
          { filename: String.raw`@@a\Album\01.flac`, state: 'Completed, Succeeded' }, // succeeded, but no id
          transfer('02.flac', { state: 'Completed, Errored', size: 100, bytesTransferred: 0 }),
        ]),
        poll([]),
      ],
    });

    const result = await run(harness, policy(100_000, 100_000));

    // Without an id the staged path cannot be resolved, so it is left out rather than mis-reported.
    expect(result).toEqual({ kind: 'failed', reason: 'TransferError', files: [] });
  });

  it('still completes when removing a settled record fails, leaving the rows for the sweep', async () => {
    const harness = downloader({
      deleteStatus: 500, // the cancel+remove DELETE errors, but the download already succeeded
      polls: [bothSucceeded],
      events: [bothCompleted],
    });

    const result = await run(harness);

    expect(result.kind).toBe('completed');
    // The records were never confirmed gone, so the rows stay live for the startup sweep to retire —
    // never falsely marked removed while a record lingers at the source (the bug this change fixes).
    expect(harness.ledger.removed).toHaveLength(0);
  });

  it('completes even when ledger bookkeeping fails, leaving the ledger untouched', async () => {
    const harness = downloader({ polls: [bothSucceeded], events: [bothCompleted] });
    harness.ledger.fail = true;

    const result = await run(harness);

    expect(result.kind).toBe('completed');
    expect(harness.ledger.created).toEqual([]);
    // Degraded stewardship is invisible in the download's outcome, so each failed write says which
    // one it was: no write-ahead trail, no id to delete with, no row retired. The three writes are
    // independent and best-effort, so WHICH faults are named — once per file — is the behaviour;
    // the order they interleave in is not, and neither is this fixture's own file count.
    const ledgerWarnings = harness.warnLogs.filter((message) => message.startsWith('ledger:'));
    expect(new Set(ledgerWarnings)).toEqual(
      new Set([
        'ledger: record transfer failed',
        'ledger: record transfer id failed',
        'ledger: mark transfer removed failed',
      ]),
    );
    expect(ledgerWarnings).toHaveLength(3 * candidate.files.length);
  });

  it('still rejects a refused enqueue when the ledger cannot release the write-ahead rows', async () => {
    // Stewardship is best-effort in both directions: a ledger fault must not turn slskd's refusal
    // into something else. The rows stay live for the startup sweep, and the log names the fault.
    const harness = downloader({ enqueue: { status: 400, body: 'boom' }, polls: [] });
    harness.ledger.fail = true;

    const started = await harness.adapter.start(ACQ, candidate, policy(1000, 1000), harness.scope);

    expect(started._unsafeUnwrap()).toEqual({ kind: 'rejected', reason: 'TransferError' });
    expect(harness.ledger.removed).toEqual([]);
    expect(harness.warnLogs).toContain('ledger: release rejected transfer failed');
  });

  it('drives an abandoned candidate’s in-flight transfers to fully removed at the source', async () => {
    // A stateful slskd double modelling the real cancel/remove guard (design D1): `?remove=true` on a
    // non-terminal transfer 500s; `?remove=false` cancels it (→ Completed, Cancelled); `?remove=true`
    // on a terminal transfer deletes the record. After teardown, no residual record must remain.
    const store = new Map<string, Record<string, unknown>>([
      [
        '01.flac',
        {
          id: '01.flac',
          filename: String.raw`@@a\Album\01.flac`,
          state: 'InProgress',
          size: 100,
          bytesTransferred: 50,
        },
      ],
      [
        '02.flac',
        {
          id: '02.flac',
          filename: String.raw`@@a\Album\02.flac`,
          state: 'InProgress',
          size: 100,
          bytesTransferred: 0,
        },
      ],
    ]);
    const http: HttpClient = {
      send: ({ method, url }) => {
        if (method === 'DELETE') {
          const match = /downloads\/u1\/([^?]*)\?remove=(true|false)/.exec(url)!;
          const id = decodeURIComponent(match[1]!);
          const transfer = store.get(id);
          if (transfer === undefined) return Promise.resolve({ status: 404, body: '' });
          const isTerminal = String(transfer.state).toLowerCase().includes('completed');
          if (match[2] === 'true') {
            if (!isTerminal) return Promise.resolve({ status: 500, body: 'not terminal' });
            store.delete(id);
          } else {
            transfer.state = 'Completed, Cancelled';
          }
          return Promise.resolve({ status: 204, body: '' });
        }
        return Promise.resolve(poll(store.values().toArray()));
      },
    };
    const ledger = new FakeResourceLedger();
    const outcomes: TryResult[] = [];
    const adapter = new SlskdDownload(
      silentLogger(),
      ledger,
      { stagingRoot: STAGING, pollIntervalMs: 1 },
      {
        progress: () => {},
        outcome: (_acquisitionId, _candidate, result) => {
          outcomes.push(result);
          return okAsync(undefined);
        },
        finished: () => {},
      },
      new SlskdClient(http),
      fakeTimer(),
    );

    const started = await adapter.start(ACQ, candidate, policy(1, 100_000), SILENT_SCOPE);
    expect(started._unsafeUnwrap()).toEqual({ kind: 'started' });
    await adapter.settled();

    expect(outcomes[0]).toMatchObject({ kind: 'failed', reason: 'Stalled' });
    // The source double is queried for residual records after teardown — none linger.
    expect(store.size).toBe(0);
    expect(ledger.removed).toHaveLength(2);
  });

  it('still delivers the completed outcome when teardown faults after the verdict settled', async () => {
    // The verdict is pinned BEFORE the source's records are torn down: a teardown transport
    // fault must not let a retried tick mis-read the emptied listing as a stall. The ledger rows
    // stay live for the startup sweep — the documented backstop.
    const harness = downloader({
      deleteThrows: true,
      polls: [bothSucceeded],
      events: [bothCompleted],
    });

    const result = await run(harness);
    expect(result.kind).toBe('completed');
    expect(harness.ledger.removed).toHaveLength(0);
  });

  it('keeps delivering through escalated persistent delivery failures, still exactly once', async () => {
    // ESCALATE_EVERY straight failures cross the threshold (the Nth is promoted to error); the
    // next attempt lands, and only one outcome was ever recorded.
    const harness = downloader({
      polls: [bothSucceeded],
      events: [bothCompleted],
      deliverFailures: ESCALATE_EVERY,
    });

    const result = await run(harness);

    expect(result.kind).toBe('completed');
    expect(harness.counts.deliveries).toBe(ESCALATE_EVERY + 1);
    expect(harness.outcomes).toHaveLength(1);
    expect(harness.warnLogs.filter((message) => message === DELIVERY_RETRY)).toHaveLength(
      ESCALATE_EVERY - 1,
    );
    expect(harness.errorLogs.filter((message) => message === DELIVERY_RETRY)).toHaveLength(1);
    // The promoted report names which outcome is stuck and how many attempts it has cost.
    expect(harness.errorContexts[harness.errorLogs.indexOf(DELIVERY_RETRY)]).toMatchObject({
      acquisitionId: ACQ,
      outcome: 'completed',
      attempt: ESCALATE_EVERY,
    });
  });

  it('self-heals through escalated persistent tick failures', async () => {
    const badPoll = { status: 200, body: JSON.stringify({ directories: 'not-an-array' }) };
    const harness = downloader({
      polls: [...Array.from({ length: ESCALATE_EVERY }, () => badPoll), bothSucceeded],
      events: [bothCompleted],
    });

    const result = await run(harness);

    expect(result.kind).toBe('completed');
    // Exactly the Nth consecutive failure is promoted; the N-1 before it stay warns.
    expect(harness.warnLogs.filter((message) => message === TICK_RETRY)).toHaveLength(
      ESCALATE_EVERY - 1,
    );
    expect(harness.errorLogs.filter((message) => message === TICK_RETRY)).toHaveLength(1);
    // The promoted report names the run length — the one thing telling a wedge from a blip.
    expect(harness.errorContexts[harness.errorLogs.indexOf(TICK_RETRY)]).toMatchObject({
      acquisitionId: ACQ,
      username: 'u1',
      consecutiveTickFailures: ESCALATE_EVERY,
    });
  });

  it('watches two acquisitions independently and delivers each outcome to its owner', async () => {
    const harness = downloader({ polls: [bothSucceeded], events: [bothCompleted] });

    const first = await harness.adapter.start(
      'acq-1',
      candidate,
      policy(1000, 1000),
      harness.scope,
    );
    const second = await harness.adapter.start(
      'acq-2',
      candidate,
      policy(1000, 1000),
      harness.scope,
    );
    expect(first._unsafeUnwrap()).toEqual({ kind: 'started' });
    expect(second._unsafeUnwrap()).toEqual({ kind: 'started' });
    await harness.adapter.settled();

    const byName = (left: string, right: string): number => left.localeCompare(right);
    expect(harness.outcomes.map((entry) => entry.acquisitionId).toSorted(byName)).toEqual([
      'acq-1',
      'acq-2',
    ]);
    expect(harness.finished.toSorted(byName)).toEqual(['acq-1', 'acq-2']);
  });

  it('aborting one download leaves a sibling download’s watch alive', async () => {
    const control = manualTimer();
    const inFlight = poll([
      transfer('01.flac', { state: 'InProgress', size: 100, bytesTransferred: 50 }),
      transfer('02.flac', { state: 'InProgress', size: 100, bytesTransferred: 50 }),
    ]);
    const harness = downloader({
      // One in-flight listing per watch's first tick; the aborts' own listings then find the
      // transfers already gone (no teardown waits to drive under the manual timer).
      polls: [inFlight, inFlight, poll([])],
      timer: control.timer,
    });

    await harness.adapter.start('acq-1', candidate, policy(100_000, 100_000), harness.scope);
    await harness.adapter.start('acq-2', candidate, policy(100_000, 100_000), harness.scope);

    const aborted = await harness.adapter.abort('acq-1', candidate, harness.scope);
    expect(aborted.isOk()).toBe(true);
    await tickUntil(control, () => harness.finished.includes('acq-1'), 'acq-1 to wind down');

    // Only the aborted download retired; the sibling's watch is still live and undelivered.
    expect(harness.finished).toEqual(['acq-1']);
    expect(harness.outcomes).toEqual([]);

    await harness.adapter.abort('acq-2', candidate, harness.scope);
    await tickUntil(control, () => harness.finished.includes('acq-2'), 'acq-2 to wind down');
    await harness.adapter.settled();
  });

  it('stop() latches every watch: nothing is delivered after shutdown', async () => {
    const control = manualTimer();
    const inFlight = poll([
      transfer('01.flac', { state: 'InProgress', size: 100, bytesTransferred: 50 }),
      transfer('02.flac', { state: 'InProgress', size: 100, bytesTransferred: 50 }),
    ]);
    const harness = downloader({ polls: [inFlight, bothSucceeded], timer: control.timer });

    const started = await harness.adapter.start(
      ACQ,
      candidate,
      policy(100_000, 100_000),
      harness.scope,
    );
    expect(started._unsafeUnwrap()).toEqual({ kind: 'started' });

    harness.adapter.stop();
    await tickUntil(control, () => harness.finished.length > 0, 'the latched watch to exit');
    await harness.adapter.settled();

    expect(harness.outcomes).toEqual([]); // no delivery raced the shutdown
  });

  it('contains an observer that throws: the watch dies loudly, nothing rejects unhandled', async () => {
    // A throw from the consumer wiring is a bug, not a modeled Err — the outer containment logs
    // it and lets the watch die (the next boot's re-drive re-drives the candidate); `watch.done`
    // never rejects, so no unhandled rejection can take the process down.
    const harness = downloader({
      polls: [bothSucceeded],
      events: [bothCompleted],
      deliverThrows: true,
    });

    const started = await harness.adapter.start(ACQ, candidate, policy(1000, 1000), harness.scope);
    expect(started._unsafeUnwrap()).toEqual({ kind: 'started' });
    await harness.adapter.settled();

    expect(harness.outcomes).toEqual([]); // the outcome was lost to the bug — and said so
    expect(harness.errorLogs).toContain(
      'download watch failed unexpectedly; a restart re-drive resumes the candidate',
    );
    expect(harness.finished).toEqual([ACQ]); // progress still retired on the way down
  });

  it('keeps a settled verdict when the teardown confirm-poll throws (verdict pinned first)', async () => {
    // The doom settled and the verdict is pinned; the teardown then cancels the in-flight file
    // and its confirmation re-poll returns a contract-violating body and throws. The guard
    // absorbs it — the failed outcome still delivers with its original reason (a retried tick
    // would have mis-read the emptied listing as a stall), and the unconfirmed ledger rows stay
    // live for the startup sweep.
    const doomed = poll([
      transfer('01.flac', { state: 'Completed, Errored', size: 100, bytesTransferred: 0 }),
      transfer('02.flac', { state: 'InProgress', size: 100, bytesTransferred: 30 }),
    ]);
    const badBody = { status: 200, body: JSON.stringify({ directories: 'not-an-array' }) };
    const harness = downloader({ polls: [doomed, badBody] });

    const result = await run(harness, policy(100_000, 100_000));

    expect(result).toMatchObject({ kind: 'failed', reason: 'TransferError' });
    expect(harness.ledger.removed).toHaveLength(0);
    // The rows outliving the attempt are the sweep's problem now, and this line is the only place
    // that says so — a silently absorbed teardown fault leaves records nobody knows to chase.
    expect(harness.warnLogs).toContain(
      'transfer teardown failed after the outcome settled; ledger rows stay live for the sweep',
    );
  });

  it('a predecessor watch winding down does not retire a successor candidate’s progress', async () => {
    // Two watches for ONE download (the failed-candidate → successor race): the first watch's
    // exit must neither delete the successor's registry entry nor blank its live progress —
    // `finished` fires only once the download's last watch ends.
    const control = manualTimer();
    const successor: Candidate = {
      identity: asCandidateIdentity({ username: 'u1', path: String.raw`@@a\Other`, sizeBytes: 9 }),
      files: [{ name: '9.flac', sizeBytes: 9 }],
      source: { speedBytesPerSec: 0, freeSlots: 1, queueLength: 0 },
    };
    const inFlight = poll([
      transfer('01.flac', { state: 'InProgress', size: 100, bytesTransferred: 50 }),
      transfer('02.flac', { state: 'InProgress', size: 100, bytesTransferred: 50 }),
    ]);
    const harness = downloader({ polls: [inFlight, inFlight, poll([])], timer: control.timer });

    await harness.adapter.start(ACQ, candidate, policy(100_000, 100_000), harness.scope);
    await harness.adapter.start(ACQ, successor, policy(100_000, 100_000), harness.scope);

    await harness.adapter.abort(ACQ, candidate, harness.scope);
    await control.tick();
    await control.tick();
    expect(harness.finished).toEqual([]); // the successor's watch still lives — nothing retired

    await harness.adapter.abort(ACQ, successor, harness.scope);
    await tickUntil(control, () => harness.finished.length > 0, 'the last watch to wind down');
    await harness.adapter.settled();
    expect(harness.finished).toEqual([ACQ]); // retired exactly once, by the last watch out
  });

  it('restarting an aborted-but-winding-down candidate registers a fresh watch safely', async () => {
    // The ensure falls through an aborted watch and replaces its registry entry; the old watch's
    // guarded cleanup must not delete the replacement, and the fresh watch delivers normally.
    const control = manualTimer();
    const inFlight = poll([
      transfer('01.flac', { state: 'InProgress', size: 100, bytesTransferred: 50 }),
      transfer('02.flac', { state: 'InProgress', size: 100, bytesTransferred: 50 }),
    ]);
    const harness = downloader({
      // The fresh watch's first tick sees the pair still in flight and parks, so the latched
      // predecessor's cleanup runs while the replacement is live — the race this guards.
      polls: [inFlight, poll([]), inFlight, bothSucceeded, poll([])],
      events: [bothCompleted],
      timer: control.timer,
    });

    const first = await harness.adapter.start(
      ACQ,
      candidate,
      policy(100_000, 100_000),
      harness.scope,
    );
    expect(first._unsafeUnwrap()).toEqual({ kind: 'started' });
    await harness.adapter.abort(ACQ, candidate, harness.scope); // latch; its listing found nothing to tear down

    const again = await harness.adapter.start(
      ACQ,
      candidate,
      policy(100_000, 100_000),
      harness.scope,
    );
    expect(again._unsafeUnwrap()).toEqual({ kind: 'started' }); // a fresh watch, not the latched one

    await control.tick(); // wake the latched predecessor; it sees the abort and winds down
    // Its cleanup released only its own reservation: the download is not retired while the
    // replacement still watches, and an ensure still finds that replacement rather than enqueueing.
    expect(harness.finished).toEqual([]);
    const ensure = await harness.adapter.start(
      ACQ,
      candidate,
      policy(100_000, 100_000),
      harness.scope,
    );
    expect(ensure._unsafeUnwrap()).toEqual({ kind: 'started' });
    expect(harness.counts.posts).toBe(2); // one per real start — the ensure enqueued nothing

    await tickUntil(control, () => harness.outcomes.length > 0, 'the fresh watch to deliver');
    await harness.adapter.settled();
    expect(harness.outcomes).toHaveLength(1);
    expect(harness.outcomes[0]!.result.kind).toBe('completed');
    expect(harness.finished).toEqual([ACQ]); // retired exactly once, by the last watch out
  });

  it('reserves the watch key before any I/O: concurrent ensures cause one enqueue, one outcome', async () => {
    // Two starts for the same key issued WITHOUT awaiting the first — the concurrent window the
    // synchronous reservation exists for. Late registration would double-enqueue and double-watch.
    const harness = downloader({ polls: [bothSucceeded], events: [bothCompleted] });

    const [first, second] = await Promise.all([
      harness.adapter.start(ACQ, candidate, policy(1000, 1000), harness.scope),
      harness.adapter.start(ACQ, candidate, policy(1000, 1000), harness.scope),
    ]);
    await harness.adapter.settled();

    expect(first._unsafeUnwrap()).toEqual({ kind: 'started' });
    expect(second._unsafeUnwrap()).toEqual({ kind: 'started' });
    expect(harness.counts.posts).toBe(1);
    expect(harness.outcomes).toHaveLength(1);
  });

  it('a failed successor start still retires progress once it was the last hope', async () => {
    // Watch A winds down seeing successor B's reservation (so A skips retirement); B's enqueue
    // is then refused and B releases LAST — B's guard path must retire the progress, or the bar
    // freezes forever for a download whose ladder has already moved on.
    const control = manualTimer();
    const gate = Promise.withResolvers<HttpResponse>();
    const successor: Candidate = {
      identity: asCandidateIdentity({ username: 'u1', path: String.raw`@@a\Other`, sizeBytes: 9 }),
      files: [{ name: '9.flac', sizeBytes: 9 }],
      source: { speedBytesPerSec: 0, freeSlots: 1, queueLength: 0 },
    };
    const inFlight = poll([
      transfer('01.flac', { state: 'InProgress', size: 100, bytesTransferred: 50 }),
      transfer('02.flac', { state: 'InProgress', size: 100, bytesTransferred: 50 }),
    ]);
    const harness = downloader({
      polls: [inFlight, poll([])],
      enqueueGates: [undefined, gate.promise], // A's enqueue answers normally; B's parks on the gate
      timer: control.timer,
    });
    // A enqueues normally (no gate yet), ticks once, parks.
    const started = await harness.adapter.start(
      ACQ,
      candidate,
      policy(100_000, 100_000),
      harness.scope,
    );
    expect(started._unsafeUnwrap()).toEqual({ kind: 'started' });
    await harness.adapter.abort(ACQ, candidate, harness.scope); // latch A; its listing found nothing to tear down

    // B reserves, then parks on its gated enqueue.
    const successorStart = harness.adapter.start(
      ACQ,
      successor,
      policy(100_000, 100_000),
      harness.scope,
    );
    await control.tick(); // A wakes, exits — sees B's reservation, skips retirement
    expect(harness.finished).toEqual([]);

    gate.resolve({ status: 400, body: 'peer gone' }); // B's enqueue refused — B releases last
    const rejected = await successorStart;
    expect(rejected._unsafeUnwrap()).toEqual({ kind: 'rejected', reason: 'TransferError' });
    await harness.adapter.settled();
    expect(harness.finished).toEqual([ACQ]); // the guard path retired the download's progress
  });

  it('contains a throwing finished() hook: the registry entry is still released', async () => {
    const harness = downloader({
      polls: [bothSucceeded],
      events: [bothCompleted],
      finishedThrows: true,
    });

    const started = await harness.adapter.start(ACQ, candidate, policy(1000, 1000), harness.scope);
    expect(started._unsafeUnwrap()).toEqual({ kind: 'started' });
    await harness.adapter.settled(); // resolves — the entry was released despite the throw

    expect(harness.outcomes).toHaveLength(1);
    expect(harness.errorLogs).toContain('watch cleanup failed');
  });

  it('an abort landing mid-tick winds the watch down quietly, not as a phantom retry', async () => {
    // The tick's poll is in flight when the abort latches; the poll then fails (at shutdown this
    // is the torn-down store/socket). The catch must recognize the latch and exit as wind-down —
    // never log the "retrying on the next tick" line for a retry that will not happen.
    const control = manualTimer();
    const pollGate = Promise.withResolvers<HttpResponse>();
    const inFlight = poll([
      transfer('01.flac', { state: 'InProgress', size: 100, bytesTransferred: 50 }),
      transfer('02.flac', { state: 'InProgress', size: 100, bytesTransferred: 50 }),
    ]);
    const harness = downloader({
      polls: [inFlight, poll([])],
      pollGates: [undefined, pollGate.promise, undefined],
      timer: control.timer,
    });

    const started = await harness.adapter.start(
      ACQ,
      candidate,
      policy(100_000, 100_000),
      harness.scope,
    );
    expect(started._unsafeUnwrap()).toEqual({ kind: 'started' });
    // Drive until tick 2's poll is provably parked on the gate (the second transfers GET).
    await tickUntil(control, () => harness.counts.polls >= 2, 'tick 2 to park on the gated poll');

    const aborted = await harness.adapter.abort(ACQ, candidate, harness.scope); // latches mid-tick
    expect(aborted.isOk()).toBe(true);
    pollGate.reject(new Error('socket torn down'));

    await tickUntil(control, () => harness.finished.length > 0, 'the latched watch to exit');
    await harness.adapter.settled();
    expect(harness.outcomes).toEqual([]);
    // The "quietly" claim, falsifiably: without the latch-recognition branch the tick catch
    // would log its phantom "retrying" warn for a retry the latch guarantees never happens.
    expect(harness.warnLogs).not.toContain('download watch tick failed; retrying on the next tick');
  });

  describe('abort', () => {
    it('cancels the candidate’s transfers, tolerating missing ids, then confirms them gone', async () => {
      const harness = downloader({
        polls: [
          poll([
            transfer('01.flac', { state: 'InProgress', size: 100, bytesTransferred: 50 }),
            { filename: String.raw`@@a\Album\02.flac` }, // ours, but no id and no state yet
            { id: 'x', state: 'InProgress' }, // no filename → not one of ours
            { id: 'other', filename: String.raw`@@a\Other\99.flac`, state: 'InProgress' }, // another dir
          ]),
          poll([]), // the teardown re-poll: both cancelled transfers are gone
        ],
      });

      const result = await harness.adapter.abort(ACQ, candidate, harness.scope);

      expect(result._unsafeUnwrap()).toEqual([]); // nothing had completed into staging
      // In-flight transfers are cancelled (remove=false); the re-poll then finds them gone.
      expect(harness.deletes).toEqual([
        'http://localhost:5030/api/v0/transfers/downloads/u1/01.flac?remove=false',
        'http://localhost:5030/api/v0/transfers/downloads/u1/?remove=false',
      ]);
      expect(harness.ledger.removed).toHaveLength(2);
    });

    it('reports the subset already completed into staging so it can be cleaned', async () => {
      const harness = downloader({
        polls: [
          poll([
            transfer('01.flac', { state: 'Completed, Succeeded' }), // already staged
            transfer('02.flac', { state: 'InProgress' }), // still in flight when cancelled
          ]),
          poll([]), // both gone after teardown
        ],
        events: [eventsPage([{ id: '01.flac', local: localOf('01.flac') }])],
      });

      const result = await harness.adapter.abort(ACQ, candidate, harness.scope);

      // The completed file's source-reported staged path is returned for the domain to discard.
      expect(result._unsafeUnwrap()).toEqual([{ name: '01.flac', path: stagedPath('01.flac') }]);
      expect(harness.ledger.removed).toHaveLength(2);
    });

    it('treats a 404 transfer listing as already-gone: nothing to abort, success (prod 2026-07-22)', async () => {
      // slskd 404s the downloads collection for a user with no transfers; for an abort that IS
      // the desired end state — converge instead of wedging the reactor on a retryable fault.
      const harness = downloader({ polls: [{ status: 404, body: '' }] });

      const result = await harness.adapter.abort(ACQ, candidate, harness.scope);

      expect(result._unsafeUnwrap()).toEqual([]);
      expect(harness.deletes).toEqual([]);
    });

    it('is a no-op when the candidate has no transfers left', async () => {
      const harness = downloader({ polls: [poll([])] });

      const result = await harness.adapter.abort(ACQ, candidate, harness.scope);

      expect(result._unsafeUnwrap()).toEqual([]);
      expect(harness.deletes).toEqual([]);
    });

    it('surfaces a contract-violating poll body as an InfraError', async () => {
      const harness = downloader({
        polls: [{ status: 200, body: JSON.stringify({ directories: 'not-an-array' }) }],
      });

      const result = await harness.adapter.abort(ACQ, candidate, harness.scope);

      expect(result._unsafeUnwrapErr()).toMatchObject({
        kind: 'InfraError',
        operation: 'slskd.abort',
      });
    });

    it('ends an in-flight watch promptly: no outcome is emitted for an aborted candidate', async () => {
      const control = manualTimer();
      const inFlight = poll([
        transfer('01.flac', { state: 'InProgress', size: 100, bytesTransferred: 50 }),
        transfer('02.flac', { state: 'InProgress', size: 100, bytesTransferred: 50 }),
      ]);
      const harness = downloader({
        // The watch's first tick sees the in-flight pair and parks on its sleep; the abort's own
        // listing then finds the transfers already gone (nothing to cancel, no teardown waits).
        polls: [inFlight, poll([])],
        timer: control.timer,
      });

      const started = await harness.adapter.start(
        ACQ,
        candidate,
        policy(100_000, 100_000),
        harness.scope,
      );
      expect(started._unsafeUnwrap()).toEqual({ kind: 'started' });

      const aborted = await harness.adapter.abort(ACQ, candidate, harness.scope);
      expect(aborted._unsafeUnwrap()).toEqual([]);

      await control.tick(); // wake the parked watch — it sees the abort and exits
      await harness.adapter.settled();

      expect(harness.outcomes).toEqual([]); // the abort path owns the settlement, not the watch
      expect(harness.finished).toEqual([ACQ]); // live progress is still retired
    });
  });
});

describe('SlskdDownload correlation pinning', () => {
  it('delivers the settled outcome under the context pinned when the watch was created', async () => {
    // A SECOND operation runs through the adapter between the start and the settle. Without that,
    // "the context pinned at creation" and "whatever context the adapter last saw" are the same
    // object and the async-hop break point this pinning exists to close is never put at risk.
    const harness = downloader({ polls: [bothSucceeded], events: [bothCompleted] });
    const opening: OperationScope = { context: testContext(STORY), logger: silentLogger() };
    const later: OperationScope = { context: testContext(OTHER_STORY), logger: silentLogger() };

    const started = await harness.adapter.start(ACQ, candidate, policy(1000, 1000), opening);
    expect(started._unsafeUnwrap()).toEqual({ kind: 'started' });
    await harness.adapter.abort('acq-unrelated', candidate, later);
    await harness.adapter.settled();

    expect(harness.outcomes[0]!.context).toEqual(opening.context);
    expect(harness.outcomes[0]!.context.correlationId).toBe(STORY);
  });

  it('logs its watch lines through the scope logger it was handed, not the construction-time root', async () => {
    // The abandonment path warns from inside the detached watch loop — after the async gap that
    // the research names as the break point. If the supervisor reached for its constructor logger
    // there, the line would carry none of the dispatch's bindings.
    const harness = downloader({
      polls: [poll([transfer('01.flac', { state: 'Queued, Remotely' })])],
      timer: fakeTimer(),
    });
    const bound: Record<string, unknown>[] = [];
    const scope: OperationScope = {
      context: harness.scope.context,
      logger: {
        ...silentLogger(),
        warn: (context: unknown) => void bound.push(context as Record<string, unknown>),
      } as OperationScope['logger'],
    };

    await harness.adapter.start(ACQ, candidate, policy(1000, 1), scope);
    await harness.adapter.settled();

    expect(bound.length).toBeGreaterThan(0);
    // And the construction-time sink stayed empty — otherwise "through the scope" is unproven:
    // any warn anywhere would satisfy the assertion above.
    expect(harness.warnLogs).toEqual([]);
  });
});

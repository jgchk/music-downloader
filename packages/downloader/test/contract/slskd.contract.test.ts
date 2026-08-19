import { testScope } from '../../src/application/__fixtures__/correlation.js';
import { afterEach, describe, expect, it } from 'vitest';
import { okAsync } from 'neverthrow';
import { FakeResourceLedger, silentLogger } from '../../src/application/__fixtures__/fakes.js';
import { SlskdClient } from '../../src/adapters/slskd/client.js';
import { SlskdDownload } from '../../src/adapters/slskd/download.js';
import { SlskdSearch } from '../../src/adapters/slskd/search.js';
import type {
  TransferProgress,
  TryResult,
} from '../../src/application/ports/outbound-ports.js';
import { baseName } from '../../src/adapters/slskd/mapping.js';
import {
  slskdDownloadFileCompleteSchema,
  slskdSearchResponsesSchema,
  slskdEnqueueRejectionSchema,
  slskdEventsSchema,
  slskdOptionsSchema,
  slskdTransfersSchema,
} from '../../src/adapters/slskd/schemas.js';
import { pollOwnedTransfers } from '../../src/adapters/slskd/poll.js';
import { resolveStagedPaths } from '../../src/adapters/slskd/staged-location.js';
import {
  FAILURE_WITNESSES,
  enqueueRejectionReason,
  flattenDownloads,
  reasonFromTransfer,
} from '../../src/adapters/slskd/transfers.js';
import type { Candidate } from '../../src/domain/candidate/candidate.js';
import { parseCandidateIdentity } from '../../src/domain/candidate/candidate.js';
import { createDownloadPolicy } from '../../src/domain/policy/policies.js';
import type { TryPolicyInput } from '../../src/domain/policy/policies.js';
import { createTarget } from '../../src/domain/target/target.js';
import type { Timer } from '../../src/adapters/slskd/timer.js';
import { loadFixtures, loadScenario } from './support/fixture.js';
import type { ContractFixture } from './support/fixture.js';
import {
  SLSKD_CONSUMED_OPERATIONS,
  undeclaredOperations,
  undeclaredQueryParams,
} from './support/slskd-manifest.js';
import { startFixtureServer } from './support/server.js';
import type { FixtureServer } from './support/server.js';

/**
 * Tier 1 for the slskd adapters: the real {@link SlskdSearch} and {@link SlskdDownload}, over real
 * `fetch`, against a local server replaying fixtures recorded from a real slskd of the pinned
 * version — no containers, no network.
 *
 * Fixtures are grouped by the recording-lab scenario that produced them, and each test serves one
 * scenario. That is not tidiness: every transfer state is another poll of the *same* URL, so a
 * queued transfer and a cancelled one can only coexist as separate recorded realities. The lab is
 * what makes them recordings rather than guesses — before it, the only witnessed transfer was a
 * successful one and the entire failure vocabulary was hand-written.
 */

const API_KEY = 'contract-test-key';

// Only the tests that drive an adapter start a server; the classification tests replay recorded
// bodies straight through the real classifier and need none.
let server: FixtureServer;
let running: FixtureServer | undefined;

/** Serve exactly one recorded scenario, and remember it for the manifest sweep below. */
async function serve(scenario: string): Promise<FixtureServer> {
  server = await startFixtureServer(loadScenario('slskd', scenario));
  running = server;
  return server;
}

function client(): SlskdClient {
  return new SlskdClient(undefined, { baseUrl: server.baseUrl, apiKey: API_KEY });
}

/** A timer whose clock jumps on sleep — no real waiting in tier 1. */
function fakeTimer(): Timer {
  let current = 0;
  return {
    now: () => current,
    sleep: (ms) => {
      current += ms;
      return Promise.resolve();
    },
  };
}

function fixtureOf(scenario: string, name: string): ContractFixture {
  const hit = loadScenario('slskd', scenario).find((f) => f.name === name);
  if (hit === undefined) throw new Error(`missing fixture ${scenario}/${name}`);
  return hit.fixture;
}

/** The transfers a recorded poll fixture carries, through the real contract schema. */
function transfersIn(scenario: string): ReturnType<typeof flattenDownloads> {
  return flattenDownloads(
    slskdTransfersSchema.parse(fixtureOf(scenario, 'transfers-poll.json').response.body),
  );
}

/** The rejection text a recorded enqueue fixture carries, through the real contract schema. */
const LAB_PEER = 'peer1';

function rejectionIn(scenario: string, name = 'transfers-enqueue.json'): string {
  return slskdEnqueueRejectionSchema.parse(fixtureOf(scenario, name).response.body);
}

interface Driven {
  readonly outcomes: TryResult[];
  readonly progress: TransferProgress[];
}

/**
 * Drive the real download adapter against the currently-served scenario for one candidate.
 *
 * The policy is built through the domain's own constructor rather than taken as a literal: a
 * `TryPolicy` is a branded type, and a test that forges the brand can exercise a policy the
 * system itself can never produce (a `maxQueueWaitMs` of 0 is exactly such a value — the
 * constructor rejects it — so the smallest legal wait, 1, is what bounds these poll loops).
 */
async function drive(candidate: Candidate, input: TryPolicyInput): Promise<Driven> {
  const policy = createDownloadPolicy(input)._unsafeUnwrap();
  const outcomes: TryResult[] = [];
  const progress: TransferProgress[] = [];
  const download = new SlskdDownload(
    silentLogger(),
    new FakeResourceLedger(),
    { stagingRoot: '/tmp/contract-staging' },
    {
      progress: (_acquisitionId, snapshot) => {
        progress.push(snapshot);
      },
      outcome: (_acquisitionId, _candidate, delivered) => {
        outcomes.push(delivered);
        return okAsync(undefined);
      },
      finished: () => {},
    },
    client(),
    fakeTimer(),
  );

  const started = await download.start('acq-contract', candidate, policy, testScope());
  if (started.isOk() && started.value.kind === 'started') await download.settled();
  return { outcomes, progress };
}

/** Build the candidate that owns a recorded transfer, so the adapter's filters match it. */
function candidateFor(scenario: string, filename: string): Candidate {
  const body = fixtureOf(scenario, 'transfers-poll.json').response.body as { username: string };
  const transfer = transfersIn(scenario).find((t) => t.filename === filename)!;
  return {
    // Built through the domain's own parser, not a branding helper: a fixture that forges a
    // value object proves nothing about the shape the system can actually hold, which is the
    // defect this tier's TryPolicy fixture had.
    identity: parseCandidateIdentity({
      username: body.username,
      path: filename,
      sizeBytes: transfer.size ?? 0,
    })._unsafeUnwrap(),
    files: [{ name: baseName(filename), sizeBytes: transfer.size ?? 0 }],
    source: { speedBytesPerSec: 0, freeSlots: 0, queueLength: 1 },
  };
}

afterEach(async () => {
  await running?.close();
  running = undefined;
});

describe('slskd contract — the lab’s happy path (full-flow)', () => {
  it('creates, polls, and maps recorded search responses into candidates', async () => {
    await serve('full-flow');
    const target = createTarget({
      type: 'album',
      artist: 'Lab Artist',
      title: 'Lab Album',
      tracks: [{ position: 1, title: 'Success Path', durationMs: 5000 }],
    })._unsafeUnwrap();
    const search = new SlskdSearch(new FakeResourceLedger(), client(), fakeTimer());

    const searched = await search.search('acq-contract', target, 1, testScope());
    const candidates = searched._unsafeUnwrap();

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0]?.files.length).toBeGreaterThan(0);
    const create = server.requests.find(
      (r) => r.method === 'POST' && r.path === '/api/v0/searches',
    )!;
    expect(create.headers['x-api-key']).toBe(API_KEY);
    expect(server.requests.some((r) => r.path.endsWith('/responses'))).toBe(true);
  });

  it('releases the search at the source when it is done with it', async () => {
    // `DELETE /api/v0/searches/{id}` was consumed for months with no fixture and no manifest entry.
    // Asserting the adapter issues it is what keeps the drift job watching it.
    await serve('full-flow');
    const target = createTarget({
      type: 'album',
      artist: 'Lab Artist',
      title: 'Lab Album',
      tracks: [{ position: 1, title: 'Success Path', durationMs: 5000 }],
    })._unsafeUnwrap();
    const search = new SlskdSearch(new FakeResourceLedger(), client(), fakeTimer());

    await search.search('acq-contract', target, 1, testScope());

    const released = server.requests.filter(
      (r) => r.method === 'DELETE' && /^\/api\/v0\/searches\/[^/]+$/.test(r.path),
    );
    expect(released.length).toBeGreaterThan(0);
    expect(released[0]!.headers['x-api-key']).toBe(API_KEY);
  });

  it('enqueues, polls the recorded transfer payload, and produces the domain-correct outcome', async () => {
    await serve('full-flow');
    const transfer = transfersIn('full-flow')[0]!;
    const candidate = candidateFor('full-flow', transfer.filename!);

    const { outcomes } = await drive(candidate, { stallTimeoutMs: 100_000, maxQueueWaitMs: 1 });

    const downloadsPath = `/api/v0/transfers/downloads/${candidate.identity.username}`;
    const enqueue = server.requests.find((r) => r.method === 'POST' && r.path === downloadsPath)!;
    expect(enqueue.headers['x-api-key']).toBe(API_KEY);
    const enqueued = JSON.parse(enqueue.body) as { filename: string; size: number }[];
    expect(enqueued[0]).toMatchObject({ filename: transfer.filename });
    expect(server.requests.some((r) => r.method === 'GET' && r.path === downloadsPath)).toBe(true);
    expect(outcomes[0]!.kind).toBe('completed');
  });

  it('pages the events log with the offset/limit query and decodes each DownloadFileComplete', async () => {
    await serve('full-flow');
    const c = client();

    const events = slskdEventsSchema.parse(await c.events(0, 100));
    const { directories } = slskdOptionsSchema.parse(await c.options());

    const completions = events.filter((event) => event.type === 'DownloadFileComplete');
    expect(completions.length).toBeGreaterThan(0);
    const wantedIds = new Set(
      completions.map(
        (event) => slskdDownloadFileCompleteSchema.parse(JSON.parse(event.data)).transfer.id,
      ),
    );

    const staged = resolveStagedPaths(wantedIds, events, directories.downloads, '/staging');
    expect(staged.size).toBe(wantedIds.size);
    for (const stagedPath of staged.values()) expect(stagedPath.startsWith('/staging/')).toBe(true);

    const eventsRequest = server.requests.find(
      (r) => r.method === 'GET' && r.path === '/api/v0/events',
    )!;
    expect(eventsRequest.query).toEqual({ offset: '0', limit: '100' });
  });

  it('records the transfer whose completion event it also captured', () => {
    // The coupling that used to be a warning comment saying the set could not be regenerated: the
    // staged-path resolver matches a completion to a poll by transfer id, so the two fixtures only
    // mean anything together. The scenario records them in one session; this proves it did.
    const polled = new Set(transfersIn('full-flow').map((t) => t.id));
    const events = slskdEventsSchema.parse(fixtureOf('full-flow', 'events.json').response.body);
    const completed = new Set(
      events.map((e) => slskdDownloadFileCompleteSchema.parse(JSON.parse(e.data)).transfer.id),
    );

    expect(polled.size).toBeGreaterThan(0);
    for (const id of polled) expect(completed).toContain(id);
  });
});

describe('slskd contract — the live-network cross-check', () => {
  it('maps candidates out of real peers, share-token paths and all', async () => {
    // The lab cannot fake this: five heterogeneous clients, filenames carrying the per-peer
    // `@@token\` share prefix that every real Soulseek share uses, and an `extension` field that
    // real peers leave empty. The lab corpus has none of those shapes — one peer, plain `corpus\`
    // paths, `extension: "flac"` — so if only lab scenarios are ever driven, a regression in the
    // share-prefix parsing or the audio filtering leaves the whole tier green. This is the test
    // that makes the "live set is the witness that the lab's shapes are the network's shapes"
    // claim true rather than aspirational.
    await serve('live');
    const target = createTarget({
      type: 'album',
      artist: 'Pink Floyd',
      title: 'The Dark Side of the Moon',
      tracks: [{ position: 1, title: 'Time', durationMs: 1000 }],
    })._unsafeUnwrap();
    const search = new SlskdSearch(new FakeResourceLedger(), client(), fakeTimer());

    const searched = await search.search('acq-contract', target, 1, testScope());
    const candidates = searched._unsafeUnwrap();

    expect(candidates.length).toBeGreaterThan(0);
    const candidate = candidates[0]!;
    expect(candidate.files.length).toBeGreaterThan(0);
    // The share prefix survives into the identity we later enqueue against — it is part of the
    // peer's own path, not decoration to be stripped...
    expect(candidate.identity.path.startsWith('@@share')).toBe(true);
    // ...while each per-file name is the basename, parsed back out of that backslash-delimited path.
    for (const file of candidate.files) {
      expect(file.name).not.toContain('\\');
      expect(file.name.length).toBeGreaterThan(0);
    }
  });

  it('never leans on the extension field real peers leave empty', () => {
    // Every file in the live capture has `extension: ""` — real clients simply do not fill it in,
    // while the lab's slskd peer does. Two guards, so a future change cannot start trusting it:
    // the raw recording still shows the field empty, and the contract schema does not model it at
    // all, so no adapter can read it even by accident.
    const raw = fixtureOf('live', 'search-responses.json').response.body as {
      files?: { extension?: string }[];
    }[];
    const extensions = new Set(raw.flatMap((peer) => (peer.files ?? []).map((f) => f.extension)));
    expect(extensions).toEqual(new Set(['']));

    const parsed = slskdSearchResponsesSchema.parse(raw);
    expect(parsed[0]!.files![0]).not.toHaveProperty('extension');
  });
});

describe('slskd contract — a queued transfer is a recorded fact', () => {
  it('reports the queue position the recorded shape carries', async () => {
    // Two facts, told straight. First: this tier never had a queued capture at all — its only
    // recorded poll was a `Completed, Succeeded` transfer, while the file's own header claimed the
    // flow "polls the recorded — genuinely `Queued, Remotely` — transfer payload". Second, from the
    // lab: `placeInQueue` is pull, not push — slskd leaves it null until something calls the
    // position endpoint. So the fixture is real only because the scenario starves the peer's single
    // upload slot AND asks for the position.
    await serve('queued');
    const queuedTransfer = transfersIn('queued').find((t) => t.state?.includes('Queued'))!;
    expect(queuedTransfer.placeInQueue).toBeGreaterThan(0);

    // A real queue budget, so the adapter polls and reports before it gives up waiting — with a
    // zero budget it abandons on the first look and never speaks.
    const { progress } = await drive(candidateFor('queued', queuedTransfer.filename!), {
      stallTimeoutMs: 100_000,
      maxQueueWaitMs: 5000,
    });

    expect(progress.map((p) => p.queuePosition)).toContain(queuedTransfer.placeInQueue);
  });

  it('names the slskd version that produced it', () => {
    const { provenance } = fixtureOf('queued', 'transfers-poll.json');
    expect(provenance.serviceVersion).toBe('0.22.5.0');
    expect(provenance.source).toMatch(/lab/i);
  });
});

describe('slskd contract — failure classification is calibrated by recorded spellings', () => {
  // Each case replays a real slskd's own words through the real classifier. A future re-record that
  // comes back with different wording fails here — loudly — instead of silently degrading every
  // distinct failure into the generic catch-all.
  it.each([
    { scenario: 'cancelled', state: 'Completed, Cancelled', reason: 'Cancelled' },
    { scenario: 'rejection', state: 'Completed, Errored', reason: 'FileUnavailable' },
    { scenario: 'errored', state: 'Completed, Errored', reason: 'PeerUnavailable' },
  ])('reads the $scenario transfer as $reason', ({ scenario, state, reason }) => {
    const failed = transfersIn(scenario).find((t) => t.state?.includes('Completed'))!;

    expect(failed.state).toBe(state);
    expect(failed.exception).toBeTruthy();
    expect(reasonFromTransfer(failed, LAB_PEER)).toBe(reason);
  });

  it.each([
    { scenario: 'rejection', name: 'transfers-enqueue.json', reason: 'FileUnavailable' },
    { scenario: 'offline', name: 'transfers-enqueue.json', reason: 'PeerUnavailable' },
    { scenario: 'unreachable', name: 'transfers-enqueue.json', reason: 'PeerUnavailable' },
    { scenario: 'stalled', name: 'transfers-enqueue.json', reason: 'Stalled' },
  ])('reads the $scenario enqueue rejection ($name) as $reason', ({ scenario, name, reason }) => {
    expect(enqueueRejectionReason(rejectionIn(scenario, name), LAB_PEER)).toBe(reason);
  });

  // Every free text slskd ever hands us: the exception on a transfer row, and the body of a
  // refused enqueue. The classifier's calibration is checked against this, not against prose.
  const recordedTexts = (): string[] => [
    ...loadFixtures('slskd').flatMap(({ fixture }) => {
      const parsed = slskdTransfersSchema.safeParse(fixture.response.body);
      if (!parsed.success) return [];
      return flattenDownloads(parsed.data)
        .map((t) => t.exception)
        .filter((e): e is string => e !== undefined);
    }),
    ...loadFixtures('slskd')
      .map(({ fixture }) => fixture.response.body)
      .filter((body): body is string => typeof body === 'string'),
  ];

  it.each(FAILURE_WITNESSES)(
    '$reason is calibrated against a recorded text',
    ({ text, reason }) => {
      // Half one: the witness still means what the table says it means.
      expect(enqueueRejectionReason(text, LAB_PEER)).toBe(reason);
      // Half two: it is a real recording, not a plausible-looking string someone typed. Without this
      // the calibration could drift into fiction exactly the way the unit stubs once did.
      expect(recordedTexts()).toContain(text);
    },
  );

  it('leaves no spelling in the classifier unexercised by a recording', () => {
    // A spelling is data inside a `.some()`, so the coverage gate cannot see an unreachable one.
    // This is the equivalent guard, and it is what forced two guessed spellings out of the table.
    const witnessed = new Set(
      FAILURE_WITNESSES.flatMap(({ text, spellings }) =>
        spellings.filter((spelling) => text.toLowerCase().includes(spelling)),
      ),
    );
    const declared = new Set(FAILURE_WITNESSES.flatMap(({ spellings }) => spellings));

    expect([...declared].filter((spelling) => !witnessed.has(spelling))).toEqual([]);
  });

  it('has no recorded text that two vocabulary entries both claim', () => {
    // The table is first-match-wins, and its docstring says the ordering is defensive rather than
    // resolving a live collision. This is what keeps that true: a future re-wording that made two
    // entries match one recorded text would silently be absorbed by whichever sits first.
    for (const { text, reason } of FAILURE_WITNESSES) {
      const claimants = FAILURE_WITNESSES.filter(
        (other) =>
          other.reason !== reason &&
          other.spellings.some((spelling) => text.toLowerCase().includes(spelling)),
      );
      expect(
        claimants.map((c) => c.reason),
        `"${text}" is claimed by more than one entry`,
      ).toEqual([]);
    }
  });

  it('tells one story about a rejection whether it arrives as a body or as a transfer row', () => {
    // The same refusal reaches us twice — as the enqueue's response and as the row slskd persisted
    // — and used to be classified differently down each path, because each path owned its own
    // substring list. One calibration table, one story.
    const row = transfersIn('rejection').find((t) => t.state?.includes('Completed'))!;

    expect(enqueueRejectionReason(rejectionIn('rejection'), LAB_PEER)).toBe(
      reasonFromTransfer(row, LAB_PEER),
    );
  });

  it('answers every enqueue failure with a 500, whatever the cause', () => {
    // Deliberately pinned, because it is the uncomfortable half of the finding: slskd 0.22.5 uses
    // 500 for a peer refusing a file, a peer being offline, and a peer never answering alike. The
    // download adapter reads >=500 as slskd itself faulting and retries, so `enqueueRejectionReason`
    // is only reached on a 4xx that the pinned slskd does not appear to send for these causes.
    // Fixing that means deciding how to tell "slskd is unwell" from "slskd says this peer is bad" —
    // a design question with its own blast radius, so it is written down here as witnessed truth and
    // proposed separately rather than smuggled into a classification change.
    for (const [scenario, name] of [
      ['rejection', 'transfers-enqueue.json'],
      ['offline', 'transfers-enqueue.json'],
      ['unreachable', 'transfers-enqueue.json'],
      ['stalled', 'transfers-enqueue.json'],
    ] as const) {
      expect(fixtureOf(scenario, name).response.status, `${scenario}/${name}`).toBe(500);
    }
  });
});

describe('slskd contract — an absent downloads collection is state, not a fault', () => {
  it('reads the recorded 404 as an empty transfer list, through the production poll', async () => {
    // Driven through `pollOwnedTransfers` — the function the watch loop actually uses — rather than
    // the raw client, so the absence default under test is production's own and not one the test
    // supplied. That distinction is the whole finding: reading this 404 as a fault is what wedged
    // the reactor on a cancelled download's abort in production.
    await serve('absent');
    const recorded = fixtureOf('absent', 'transfers-poll.json');
    // Pinned: re-recording this as a 200-with-empty-body would keep the test green while silently
    // retiring the very signal it exists for.
    expect(recorded.response.status).toBe(404);
    const username = decodeURIComponent(recorded.request.path.split('/').pop()!);

    // A wanted set drawn from a real recording, so an empty result can only come from the 404
    // default — not from the ownership filter discarding everything regardless.
    const wanted = new Set(transfersIn('full-flow').map((t) => t.filename!));
    const mine = await pollOwnedTransfers(client(), username, wanted);

    expect(mine).toEqual([]);
    expect(
      server.requests.some((r) => r.method === 'GET' && r.path === recorded.request.path),
    ).toBe(true);
  });
});

describe('slskd contract — the teardown speaks its two-phase removal', () => {
  // The `?remove=` value is the difference between cancelling a transfer and destroying its record,
  // and slskd rejects the wrong one outright. It is declared in the manifest and checked against the
  // OpenAPI snapshot — but until these two tests nothing observed the adapter still *sending* it, so
  // an adapter that stopped would have passed the whole tier. Which phase you see depends on what
  // the transfer was doing, so each is witnessed by the scenario that produces it.
  const removalsSent = (): (string | undefined)[] =>
    server.requests
      .filter((r) => r.method === 'DELETE' && r.path.includes('/transfers/downloads/'))
      .map((r) => r.query.remove);

  it('cancels a still-live transfer with ?remove=false', async () => {
    await serve('queued');
    const queued = transfersIn('queued').find((t) => t.state?.includes('Queued'))!;

    // Abandoning on the queue deadline tears down a transfer that has not reached Completed.
    await drive(candidateFor('queued', queued.filename!), {
      stallTimeoutMs: 100_000,
      maxQueueWaitMs: 1,
    });

    expect(removalsSent().length).toBeGreaterThan(0);
    expect(new Set(removalsSent())).toEqual(new Set(['false']));
  });

  it('removes an already-terminal transfer with ?remove=true', async () => {
    await serve('full-flow');
    const settled = transfersIn('full-flow')[0]!;

    await drive(candidateFor('full-flow', settled.filename!), {
      stallTimeoutMs: 100_000,
      maxQueueWaitMs: 1,
    });

    expect(removalsSent()).toContain('true');
  });
});

describe('slskd contract — a refused enqueue today', () => {
  it('is retried as infrastructure, because the pinned slskd refuses with a 500', async () => {
    // The uncomfortable behaviour, asserted rather than described. `enqueueRejectionReason` is
    // calibrated for these bodies, but on the pinned slskd they arrive as 500s and never reach it —
    // the adapter reports a retryable infrastructure fault instead of failing the candidate. This
    // test is the red baseline for the follow-up change; the day slskd answers 4xx, or the day we
    // read the body, it changes colour instead of a design note going quietly stale.
    await serve('rejection');
    const candidate: Candidate = {
      identity: parseCandidateIdentity({
        username: 'peer1',
        path: 'corpus/missing.flac',
        sizeBytes: 1,
      })._unsafeUnwrap(),
      files: [{ name: 'missing.flac', sizeBytes: 1 }],
      source: { speedBytesPerSec: 0, freeSlots: 0, queueLength: 0 },
    };
    const download = new SlskdDownload(
      silentLogger(),
      new FakeResourceLedger(),
      { stagingRoot: '/tmp/contract-staging' },
      { progress: () => {}, outcome: () => okAsync(undefined), finished: () => {} },
      client(),
      fakeTimer(),
    );

    const started = await download.start(
      'acq-contract',
      candidate,
      createDownloadPolicy({ stallTimeoutMs: 100_000, maxQueueWaitMs: 1 })._unsafeUnwrap(),
      testScope(),
    );

    expect(started.isErr()).toBe(true);
    expect(started._unsafeUnwrapErr().message).toContain('500');
  });
});

describe('slskd contract — the manifest declares everything the adapters send', () => {
  // Driven here rather than read off whatever ran earlier in the file: as an accumulator this
  // assertion silently checked less whenever a test above it was skipped, and failed spuriously
  // under `-t` or `.only`. Its scope is now explicit.
  async function everyIssuedRequest(): Promise<
    { method: string; path: string; query: Record<string, string> }[]
  > {
    const collected: { method: string; path: string; query: Record<string, string> }[] = [];
    for (const scenario of ['full-flow', 'queued'] as const) {
      const running = await startFixtureServer(loadScenario('slskd', scenario));
      server = running;
      const target = createTarget({
        type: 'album',
        artist: 'Lab Artist',
        title: 'Lab Album',
        tracks: [{ position: 1, title: 'Success Path', durationMs: 5000 }],
      })._unsafeUnwrap();
      await new SlskdSearch(new FakeResourceLedger(), client(), fakeTimer()).search(
        'acq-contract',
        target,
        1,
        testScope(),
      );
      const transfer = transfersIn(scenario)[0]!;
      await drive(candidateFor(scenario, transfer.filename!), {
        stallTimeoutMs: 100_000,
        maxQueueWaitMs: 1,
      });
      collected.push(...running.requests);
      await running.close();
    }
    return collected;
  }

  it('issued no request outside the consumed-operations manifest', async () => {
    const requests = await everyIssuedRequest();

    expect(requests.length).toBeGreaterThan(0);
    expect(undeclaredOperations(requests, SLSKD_CONSUMED_OPERATIONS)).toEqual([]);
  });

  it('sent no query parameter the manifest does not declare', async () => {
    const requests = await everyIssuedRequest();

    expect(undeclaredQueryParams(requests, SLSKD_CONSUMED_OPERATIONS)).toEqual([]);
  });
});

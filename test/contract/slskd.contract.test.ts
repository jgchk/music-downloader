import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { silentLogger } from '../../src/application/__fixtures__/fakes.js';
import { SlskdClient } from '../../src/adapters/slskd/client.js';
import { SlskdDownload } from '../../src/adapters/slskd/download.js';
import { SlskdSearch } from '../../src/adapters/slskd/search.js';
import { baseName } from '../../src/adapters/slskd/mapping.js';
import { slskdTransfersSchema } from '../../src/adapters/slskd/schemas.js';
import { aggregate, flattenDownloads } from '../../src/adapters/slskd/transfers.js';
import type { Candidate } from '../../src/domain/candidate/candidate.js';
import type { DownloadPolicy } from '../../src/domain/policy/policies.js';
import { createTarget } from '../../src/domain/target/target.js';
import type { Timer } from '../../src/adapters/slskd/timer.js';
import { loadFixtures } from './support/fixture.js';
import type { ContractFixture } from './support/fixture.js';
import { startFixtureServer } from './support/server.js';
import type { FixtureServer } from './support/server.js';

/**
 * Tier 1 for the slskd adapters (task 3.3): the real {@link SlskdSearch} and {@link SlskdDownload},
 * over real `fetch`, run against a local server serving the recorded fixtures. The search flow is
 * driven end to end (create → poll → responses → candidates); the download flow enqueues, polls the
 * recorded — genuinely `Queued, Remotely` — transfer payload, and abandons on the queue deadline,
 * asserting the authenticated requests the adapter sends at each step.
 */

const API_KEY = 'contract-test-key';
const fixtures = loadFixtures('slskd');
const byName = (name: string): ContractFixture => {
  const hit = fixtures.find((f) => f.name === name);
  if (hit === undefined) throw new Error(`missing fixture ${name}`);
  return hit.fixture;
};

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

let server: FixtureServer;
function client(): SlskdClient {
  return new SlskdClient(undefined, { baseUrl: server.baseUrl, apiKey: API_KEY });
}

beforeEach(async () => {
  server = await startFixtureServer(fixtures);
});
afterEach(async () => {
  await server.close();
});

describe('slskd contract (tier 1)', () => {
  it('creates, polls, and maps recorded search responses into candidates', async () => {
    const target = createTarget({
      type: 'album',
      artist: 'Pink Floyd',
      title: 'The Dark Side of the Moon',
      tracks: [{ position: 1, title: 'Time', durationMs: 1000 }],
    })._unsafeUnwrap();
    const search = new SlskdSearch(silentLogger(), client(), fakeTimer());

    const candidates = (await search.search(target, 1))._unsafeUnwrap();

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0]?.files.length).toBeGreaterThan(0);

    const create = server.requests.find(
      (r) => r.method === 'POST' && r.path === '/api/v0/searches',
    )!;
    expect(create.headers['x-api-key']).toBe(API_KEY);
    expect(JSON.parse(create.body)).toMatchObject({
      searchText: 'Pink Floyd The Dark Side of the Moon',
    });
    expect(server.requests.some((r) => r.path.endsWith('/responses'))).toBe(true);
  });

  it('enqueues, polls the recorded transfer payload, and produces the domain-correct outcome', async () => {
    const pollFixture = byName('transfers-poll.json');
    const body = pollFixture.response.body as { username: string };
    const payload = slskdTransfersSchema.parse(pollFixture.response.body);
    const transfer = flattenDownloads(payload)[0]!;
    // The outcome the pure pipeline predicts from the real payload — the adapter, fed the same bytes
    // over the wire, must reach the identical interpretation.
    const expected = aggregate([transfer]);

    const candidate: Candidate = {
      identity: {
        username: body.username,
        path: transfer.filename!,
        sizeBytes: transfer.size ?? 0,
      },
      files: [{ name: baseName(transfer.filename!), sizeBytes: transfer.size ?? 0 }],
      source: { speedBytesPerSec: 0, freeSlots: 0, queueLength: 1 },
    };
    // maxQueueWaitMs 0 makes a still-queued transfer abandon on the first poll instead of looping.
    const policy: DownloadPolicy = { stallTimeoutMs: 100_000, maxQueueWaitMs: 0 };
    const download = new SlskdDownload(
      silentLogger(),
      { stagingRoot: '/tmp/contract-staging' },
      client(),
      fakeTimer(),
    );

    const result = (await download.download(candidate, policy, () => undefined))._unsafeUnwrap();

    const downloadsPath = `/api/v0/transfers/downloads/${body.username}`;
    const enqueue = server.requests.find((r) => r.method === 'POST' && r.path === downloadsPath)!;
    expect(enqueue.headers['x-api-key']).toBe(API_KEY);
    expect(JSON.parse(enqueue.body)[0]).toMatchObject({ filename: transfer.filename });
    expect(server.requests.some((r) => r.method === 'GET' && r.path === downloadsPath)).toBe(true);

    if (expected.settled && expected.succeeded) {
      expect(result.kind).toBe('completed');
    } else {
      // A still-queued transfer is abandoned: the outcome fails and a cancel DELETE is issued.
      expect(result.kind).toBe('failed');
      expect(
        server.requests.some(
          (r) => r.method === 'DELETE' && r.path === `${downloadsPath}/${transfer.id}`,
        ),
      ).toBe(true);
    }
  });
});

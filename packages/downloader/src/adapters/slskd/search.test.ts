import { describe, expect, it } from 'vitest';
import { FakeResourceLedger, silentLogger } from '../../application/__fixtures__/fakes.js';
import { createTarget } from '../../domain/target/target.js';
import type { Target } from '../../domain/target/target.js';
import type { HttpClient, HttpRequest, HttpResponse } from '../support/http.js';
import { SlskdClient } from './client.js';
import { SlskdSearch } from './search.js';
import type { Timer } from './timer.js';

const ACQ = 'acq-1';

function json(body: unknown, status = 200): HttpResponse {
  return { status, body: JSON.stringify(body) };
}

/** A timer whose clock advances only when the code under test sleeps — deterministic polling. */
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

interface Routes {
  create?: HttpResponse;
  state?: () => HttpResponse;
  responses?: HttpResponse;
  del?: HttpResponse; // a non-2xx here makes the client throw, exercising the delete-failure path
}

function httpFor(routes: Routes, requests: HttpRequest[]): HttpClient {
  return {
    send: (request: HttpRequest) => {
      requests.push(request);
      const { method, url } = request;
      if (method === 'POST') return Promise.resolve(routes.create ?? json({ id: 's1' }));
      if (method === 'DELETE') return Promise.resolve(routes.del ?? { status: 204, body: '' });
      if (url.endsWith('/responses')) return Promise.resolve(routes.responses ?? json([]));
      return Promise.resolve(routes.state?.() ?? json({ isComplete: true }));
    },
  };
}

interface Harness {
  adapter: SlskdSearch;
  ledger: FakeResourceLedger;
  requests: HttpRequest[];
}

function searcher(routes: Routes, timeoutMs = 15_000): Harness {
  const ledger = new FakeResourceLedger();
  const requests: HttpRequest[] = [];
  const adapter = new SlskdSearch(
    silentLogger(),
    ledger,
    new SlskdClient(httpFor(routes, requests)),
    fakeTimer(),
    { pollIntervalMs: 10, searchTimeoutMs: timeoutMs },
  );
  return { adapter, ledger, requests };
}

const albumTarget: Target = createTarget({
  type: 'album',
  artist: 'Artist',
  title: 'Album',
  tracks: [{ position: 1, title: 'T', durationMs: 1000 }],
})._unsafeUnwrap();

const albumResponses = [
  { username: 'u1', uploadSpeed: 900, files: [{ filename: '@@a\\Album\\01.flac', size: 100 }] },
];

function deletedSearchIds(requests: readonly HttpRequest[]): string[] {
  return requests
    .filter((r) => r.method === 'DELETE' && r.url.includes('/api/v0/searches/'))
    .map((r) => r.url.split('/api/v0/searches/')[1]!);
}

describe('SlskdSearch', () => {
  it('creates, awaits completion, groups responses, records ownership, and deletes after harvest', async () => {
    const { adapter, ledger, requests } = searcher({
      state: () => json({ isComplete: true }),
      responses: json(albumResponses),
    });

    const result = await adapter.search(ACQ, albumTarget, 1);

    expect(result._unsafeUnwrap()).toEqual([
      {
        identity: { username: 'u1', path: '@@a\\Album', sizeBytes: 100 },
        files: [expect.objectContaining({ name: '01.flac' })],
        source: { speedBytesPerSec: 900, freeSlots: 0, queueLength: 0 },
      },
    ]);
    // Recorded on creation, then deleted from slskd and marked removed once harvested.
    expect(ledger.created).toEqual([
      { source: 'slskd', kind: 'search', resourceKey: 's1', resourceId: 's1', acquisitionId: ACQ },
    ]);
    expect(deletedSearchIds(requests)).toEqual(['s1']);
    expect(ledger.removed).toHaveLength(1);
  });

  it('returns an empty list when the search finds nothing', async () => {
    const result = await searcher({ responses: json([]) }).adapter.search(ACQ, albumTarget, 1);

    expect(result._unsafeUnwrap()).toEqual([]);
  });

  it('polls until slskd reports the search complete', async () => {
    let polls = 0;
    const result = await searcher({
      state: () => {
        polls += 1;
        return json({ isComplete: polls >= 2 });
      },
      responses: json(albumResponses),
    }).adapter.search(ACQ, albumTarget, 2);

    expect(polls).toBe(2);
    expect(result._unsafeUnwrap()).toHaveLength(1);
  });

  it('faults when the deadline elapses with the search still in progress', async () => {
    const { adapter, ledger, requests } = searcher(
      { state: () => json({ isComplete: false, state: 'InProgress', responseCount: 180 }) },
      0,
    );

    const result = await adapter.search(ACQ, albumTarget, 1);

    // An unconfirmed search is a truncated read, not an empty result: slskd persists responses
    // only at finalization, so harvesting now would report "nothing exists" for a running search.
    const error = result._unsafeUnwrapErr();
    expect(error).toMatchObject({ kind: 'InfraError', operation: 'slskd.search' });
    expect(error.message).toContain('incomplete');
    // No harvest, no mid-flight delete (deleting a running search corrupts slskd's search task);
    // the live ledger row leaves the search to the startup sweep.
    expect(requests.some((r) => r.url.endsWith('/responses'))).toBe(false);
    expect(deletedSearchIds(requests)).toEqual([]);
    expect(ledger.created).toHaveLength(1);
    expect(ledger.removed).toEqual([]);
  });

  it('reports unknown state details when the incomplete search omits them', async () => {
    const result = await searcher({ state: () => json({ isComplete: false }) }, 0).adapter.search(
      ACQ,
      albumTarget,
      1,
    );

    expect(result._unsafeUnwrapErr().message).toContain('state=unknown, responseCount=unknown');
  });

  it('faults when the harvest contradicts the search state', async () => {
    const { adapter, ledger, requests } = searcher({
      state: () => json({ isComplete: true, responseCount: 3 }),
      responses: json([]),
    });

    const result = await adapter.search(ACQ, albumTarget, 1);

    expect(result._unsafeUnwrapErr()).toMatchObject({
      kind: 'InfraError',
      operation: 'slskd.search',
    });
    expect(deletedSearchIds(requests)).toEqual([]);
    expect(ledger.removed).toEqual([]);
  });

  it('accepts a confirmed-complete search that genuinely found nothing', async () => {
    const { adapter, requests } = searcher({
      state: () => json({ isComplete: true, responseCount: 0 }),
      responses: json([]),
    });

    const result = await adapter.search(ACQ, albumTarget, 1);

    expect(result._unsafeUnwrap()).toEqual([]);
    expect(deletedSearchIds(requests)).toEqual(['s1']);
  });

  it('harvests a completed search whose state omits the response count', async () => {
    // Tolerant reader: an absent responseCount cannot contradict the harvest.
    const result = await searcher({
      state: () => json({ isComplete: true }),
      responses: json(albumResponses),
    }).adapter.search(ACQ, albumTarget, 1);

    expect(result._unsafeUnwrap()).toHaveLength(1);
  });

  it('tolerates a create response without a search id', async () => {
    const result = await searcher({ create: json({}), responses: json([]) }).adapter.search(
      ACQ,
      albumTarget,
      1,
    );

    expect(result._unsafeUnwrap()).toEqual([]);
  });

  it('still returns candidates when deleting the harvested search fails', async () => {
    const { adapter, ledger, requests } = searcher({
      responses: json(albumResponses),
      del: { status: 500, body: 'boom' },
    });

    const result = await adapter.search(ACQ, albumTarget, 1);

    expect(result._unsafeUnwrap()).toHaveLength(1);
    // The delete was attempted but failed, so the ledger row is left live for the sweep.
    expect(deletedSearchIds(requests)).toEqual(['s1']);
    expect(ledger.removed).toEqual([]);
  });

  it('still returns candidates when ledger bookkeeping fails', async () => {
    const { adapter, ledger } = searcher({ responses: json(albumResponses) });
    ledger.fail = true;

    const result = await adapter.search(ACQ, albumTarget, 1);

    expect(result._unsafeUnwrap()).toHaveLength(1);
    expect(ledger.created).toEqual([]); // recording was attempted but swallowed
  });

  it('falls back to default poll and timeout config', async () => {
    const search = new SlskdSearch(
      silentLogger(),
      new FakeResourceLedger(),
      new SlskdClient(httpFor({ responses: json(albumResponses) }, [])),
      fakeTimer(),
    );

    const result = await search.search(ACQ, albumTarget, 1);

    expect(result._unsafeUnwrap()).toHaveLength(1);
  });

  it('surfaces an unexpected HTTP status as an InfraError', async () => {
    const result = await searcher({ create: json({}, 503) }).adapter.search(ACQ, albumTarget, 1);

    expect(result._unsafeUnwrapErr()).toMatchObject({
      kind: 'InfraError',
      operation: 'slskd.search',
    });
  });

  it('surfaces a contract-violating responses body as an InfraError', async () => {
    const result = await searcher({ responses: json({ not: 'an array' }) }).adapter.search(
      ACQ,
      albumTarget,
      1,
    );

    expect(result._unsafeUnwrapErr()).toMatchObject({
      kind: 'InfraError',
      operation: 'slskd.search',
    });
  });
});

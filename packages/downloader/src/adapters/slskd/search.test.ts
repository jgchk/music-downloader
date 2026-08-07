import { testScope } from '../../application/__fixtures__/correlation.js';
import type { OperationScope } from '../../application/correlation/context.js';
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
  /** Every warning the adapter logged, in order — the operator's only account of a swallowed fault. */
  warnings: string[];
  /** The scope to hand `search` when the test asserts on {@link Harness.warnings}. */
  scope: OperationScope;
}

function searcher(routes: Routes, timeoutMs = 15_000): Harness {
  const ledger = new FakeResourceLedger();
  const requests: HttpRequest[] = [];
  const warnings: string[] = [];
  // The adapter logs through the scope it is handed, so the capturing logger rides in on the scope.
  const scope: OperationScope = {
    ...testScope(),
    logger: {
      ...silentLogger(),
      warn: (_context: unknown, message?: string) => {
        warnings.push(message ?? '');
      },
    },
  };
  const adapter = new SlskdSearch(ledger, new SlskdClient(httpFor(routes, requests)), fakeTimer(), {
    pollIntervalMs: 10,
    searchTimeoutMs: timeoutMs,
  });
  return { adapter, ledger, requests, warnings, scope };
}

const albumTarget: Target = createTarget({
  type: 'album',
  artist: 'Artist',
  title: 'Album',
  tracks: [{ position: 1, title: 'T', durationMs: 1000 }],
})._unsafeUnwrap();

const albumResponses = [
  {
    username: 'u1',
    uploadSpeed: 900,
    files: [{ filename: String.raw`@@a\Album\01.flac`, size: 100 }],
  },
];

function createdSearchTexts(requests: readonly HttpRequest[]): unknown[] {
  return requests
    .filter((r) => r.method === 'POST')
    .map((r) => JSON.parse(r.body ?? 'null') as unknown);
}

function deletedSearchIds(requests: readonly HttpRequest[]): string[] {
  return requests
    .filter((r) => r.method === 'DELETE' && r.url.includes('/api/v0/searches/'))
    .map((r) => r.url.split('/api/v0/searches/', 2)[1]!);
}

describe('SlskdSearch', () => {
  it('creates, awaits completion, groups responses, records ownership, and deletes after harvest', async () => {
    const { adapter, ledger, requests } = searcher({
      state: () => json({ isComplete: true, state: 'Completed, TimedOut', responseCount: 1 }), // vocabulary-exempt: SEARCH state
      responses: json(albumResponses),
    });

    const result = await adapter.search(ACQ, albumTarget, 1, testScope());

    // What slskd is asked to search for: the target's artist and title, and nothing else.
    expect(createdSearchTexts(requests)).toEqual([{ searchText: 'Artist Album' }]);
    expect(result._unsafeUnwrap()).toEqual([
      {
        identity: { username: 'u1', path: String.raw`@@a\Album`, sizeBytes: 100 },
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
    const result = await searcher({ responses: json([]) }).adapter.search(
      ACQ,
      albumTarget,
      1,
      testScope(),
    );

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
    }).adapter.search(ACQ, albumTarget, 2, testScope());

    expect(polls).toBe(2);
    expect(result._unsafeUnwrap()).toHaveLength(1);
  });

  it('stops polling at the deadline rather than one interval past it', async () => {
    // The deadline is inclusive: the poll that observes it is the last one. `pollIntervalMs` is 10
    // and the fake clock only advances on a sleep, so the third poll is the one that reads 20ms.
    let polls = 0;
    const result = await searcher(
      {
        state: () => {
          polls += 1;
          return json({ isComplete: false });
        },
      },
      20,
    ).adapter.search(ACQ, albumTarget, 1, testScope());

    expect(result._unsafeUnwrapErr().message).toContain('incomplete');
    expect(polls).toBe(3);
  });

  it('faults when the deadline elapses with the search still in progress', async () => {
    const { adapter, ledger, requests } = searcher(
      { state: () => json({ isComplete: false, state: 'InProgress', responseCount: 180 }) },
      0,
    );

    const result = await adapter.search(ACQ, albumTarget, 1, testScope());

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
      testScope(),
    );

    expect(result._unsafeUnwrapErr().message).toContain('state=unknown, responseCount=unknown');
  });

  it('faults when the harvest contradicts the search state', async () => {
    const { adapter, ledger, requests } = searcher({
      state: () => json({ isComplete: true, responseCount: 3 }),
      responses: json([]),
    });

    const result = await adapter.search(ACQ, albumTarget, 1, testScope());

    const error = result._unsafeUnwrapErr();
    expect(error).toMatchObject({ kind: 'InfraError', operation: 'slskd.search' });
    expect(error.message).toContain('reported 3 responses');
    expect(deletedSearchIds(requests)).toEqual([]);
    expect(ledger.removed).toEqual([]);
  });

  it('accepts a confirmed-complete search that genuinely found nothing', async () => {
    const { adapter, requests } = searcher({
      state: () => json({ isComplete: true, responseCount: 0 }),
      responses: json([]),
    });

    const result = await adapter.search(ACQ, albumTarget, 1, testScope());

    expect(result._unsafeUnwrap()).toEqual([]);
    expect(deletedSearchIds(requests)).toEqual(['s1']);
  });

  it('accepts an empty harvest when the state omits the response count (gate disarmed)', async () => {
    // Tolerant reader: with no responseCount there is nothing for an empty harvest to contradict.
    const result = await searcher({
      state: () => json({ isComplete: true }),
      responses: json([]),
    }).adapter.search(ACQ, albumTarget, 1, testScope());

    expect(result._unsafeUnwrap()).toEqual([]);
  });

  it.each([{ body: {} }, { body: { id: '' } }])(
    'faults when the create response carries no usable search id ($body)',
    async ({ body }) => {
      const { adapter, ledger, requests } = searcher({ create: json(body) });

      const result = await adapter.search(ACQ, albumTarget, 1, testScope());

      // An id-less create is an incoherent read — the search could never be polled or swept.
      const error = result._unsafeUnwrapErr();
      expect(error).toMatchObject({ kind: 'InfraError', operation: 'slskd.search' });
      expect(error.message).toContain('no search id');
      expect(ledger.created).toEqual([]);
      expect(deletedSearchIds(requests)).toEqual([]);
    },
  );

  it('trusts a harvest smaller than the advertised response count', async () => {
    // responseCount tallies per-peer responses; only an all-or-nothing contradiction faults.
    const result = await searcher({
      state: () => json({ isComplete: true, responseCount: 180 }),
      responses: json(albumResponses),
    }).adapter.search(ACQ, albumTarget, 1, testScope());

    expect(result._unsafeUnwrap()).toHaveLength(1);
  });

  it("defaults the deadline to 60s, above slskd's own search duration", async () => {
    const search = new SlskdSearch(
      new FakeResourceLedger(),
      new SlskdClient(httpFor({ state: () => json({ isComplete: false }) }, [])),
      fakeTimer(),
    );

    const result = await search.search(ACQ, albumTarget, 1, testScope());

    expect(result._unsafeUnwrapErr().message).toContain('60000ms');
  });

  it('still returns candidates when deleting the harvested search fails', async () => {
    const { adapter, ledger, requests } = searcher({
      responses: json(albumResponses),
      del: { status: 500, body: 'boom' },
    });

    const result = await adapter.search(ACQ, albumTarget, 1, testScope());

    expect(result._unsafeUnwrap()).toHaveLength(1);
    // The delete was attempted but failed, so the ledger row is left live for the sweep.
    expect(deletedSearchIds(requests)).toEqual(['s1']);
    expect(ledger.removed).toEqual([]);
  });

  it('still returns candidates when ledger bookkeeping fails', async () => {
    const { adapter, ledger } = searcher({ responses: json(albumResponses) });
    ledger.fail = true;

    const result = await adapter.search(ACQ, albumTarget, 1, testScope());

    expect(result._unsafeUnwrap()).toHaveLength(1);
    expect(ledger.created).toEqual([]); // recording was attempted but swallowed
  });

  it('names which ledger write failed when the bookkeeping is refused', async () => {
    const { adapter, ledger, warnings, scope } = searcher({
      state: () => json({ isComplete: true, responseCount: 1 }),
      responses: json(albumResponses),
    });
    ledger.fail = true;

    await adapter.search(ACQ, albumTarget, 1, scope);

    // Swallowed from the caller, so the log is the only place an operator learns which write went
    // missing — and the two mean different things: a search that was never recorded is one the
    // sweep will never find, while one that was never marked removed leaves a live row the sweep
    // will chase against a search that is already gone.
    expect(warnings).toEqual([
      'ledger: record search failed',
      'ledger: mark search removed failed',
    ]);
  });

  it('warns about nothing when the search and its bookkeeping both go through', async () => {
    const { adapter, warnings, scope } = searcher({
      state: () => json({ isComplete: true, responseCount: 1 }),
      responses: json(albumResponses),
    });

    await adapter.search(ACQ, albumTarget, 1, scope);

    expect(warnings).toEqual([]);
  });

  it('falls back to default poll and timeout config', async () => {
    const search = new SlskdSearch(
      new FakeResourceLedger(),
      new SlskdClient(httpFor({ responses: json(albumResponses) }, [])),
      fakeTimer(),
    );

    const result = await search.search(ACQ, albumTarget, 1, testScope());

    expect(result._unsafeUnwrap()).toHaveLength(1);
  });

  it('surfaces an unexpected HTTP status as an InfraError', async () => {
    const result = await searcher({ create: json({}, 503) }).adapter.search(
      ACQ,
      albumTarget,
      1,
      testScope(),
    );

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
      testScope(),
    );

    expect(result._unsafeUnwrapErr()).toMatchObject({
      kind: 'InfraError',
      operation: 'slskd.search',
    });
  });
});

import { describe, expect, it } from 'vitest';
import { silentLogger } from '../../application/__fixtures__/fakes.js';
import { createTarget } from '../../domain/target/target.js';
import type { Target } from '../../domain/target/target.js';
import type { HttpClient, HttpResponse } from '../support/http.js';
import { SlskdClient } from './client.js';
import { SlskdSearch } from './search.js';
import type { Timer } from './timer.js';

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
}

function httpFor(routes: Routes): HttpClient {
  return {
    send: ({ method, url }) => {
      if (method === 'POST') return Promise.resolve(routes.create ?? json({ id: 's1' }));
      if (url.endsWith('/responses')) return Promise.resolve(routes.responses ?? json([]));
      return Promise.resolve(routes.state?.() ?? json({ isComplete: true }));
    },
  };
}

function searcher(routes: Routes, timeoutMs = 15_000): SlskdSearch {
  return new SlskdSearch(silentLogger(), new SlskdClient(httpFor(routes)), fakeTimer(), {
    pollIntervalMs: 10,
    searchTimeoutMs: timeoutMs,
  });
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

describe('SlskdSearch', () => {
  it('creates, awaits completion, and groups responses into candidates', async () => {
    const result = await searcher({
      state: () => json({ isComplete: true }),
      responses: json(albumResponses),
    }).search(albumTarget, 1);

    expect(result._unsafeUnwrap()).toEqual([
      {
        identity: { username: 'u1', path: '@@a\\Album', sizeBytes: 100 },
        files: [expect.objectContaining({ name: '01.flac' })],
        source: { speedBytesPerSec: 900, freeSlots: 0, queueLength: 0 },
      },
    ]);
  });

  it('returns an empty list when the search finds nothing', async () => {
    const result = await searcher({ responses: json([]) }).search(albumTarget, 1);

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
    }).search(albumTarget, 2);

    expect(polls).toBe(2);
    expect(result._unsafeUnwrap()).toHaveLength(1);
  });

  it('stops polling and reads whatever arrived once the timeout elapses', async () => {
    const result = await searcher(
      { state: () => json({ isComplete: false }), responses: json([]) },
      0,
    ).search(albumTarget, 1);

    expect(result._unsafeUnwrap()).toEqual([]);
  });

  it('tolerates a create response without a search id', async () => {
    const result = await searcher({ create: json({}), responses: json([]) }).search(albumTarget, 1);

    expect(result._unsafeUnwrap()).toEqual([]);
  });

  it('falls back to default poll and timeout config', async () => {
    const search = new SlskdSearch(
      silentLogger(),
      new SlskdClient(httpFor({ responses: json(albumResponses) })),
      fakeTimer(),
    );

    const result = await search.search(albumTarget, 1);

    expect(result._unsafeUnwrap()).toHaveLength(1);
  });

  it('surfaces an unexpected HTTP status as an InfraError', async () => {
    const result = await searcher({ create: json({}, 503) }).search(albumTarget, 1);

    expect(result._unsafeUnwrapErr()).toMatchObject({
      kind: 'InfraError',
      operation: 'slskd.search',
    });
  });
});

import { ResultAsync, errAsync, ok, okAsync } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';
import { cachingCoverArt } from './cache.js';
import type { CoverArtAnswer, CoverArtPort, CoverArtUnavailable } from './port.js';

const MBID = '19847822-1430-3380-9cf1-bc45545b34ac';
const OTHER_MBID = '271faeb3-fdd1-3ebb-80aa-97b3116e9341';

function found(size: number): CoverArtAnswer {
  return {
    kind: 'found',
    image: { contentType: 'image/jpeg', bytes: new Uint8Array(size) },
  };
}

/**
 * A port that answers with the given outcomes in order, counting how often it was asked.
 * `'unavailable'` is the archive itself failing; `'record-unavailable'` is one identifier's
 * artwork failing, which says nothing about the next one.
 */
function archive(
  ...answers: (CoverArtAnswer | 'unavailable' | 'record-unavailable')[]
): CoverArtPort & { calls: () => number } {
  const front = vi.fn(() => {
    const next = answers.shift() ?? found(4);
    if (next === 'unavailable') {
      return errAsync({
        kind: 'cover-art-unavailable' as const,
        detail: 'down',
        scope: 'archive' as const,
      });
    }
    if (next === 'record-unavailable') {
      return errAsync({
        kind: 'cover-art-unavailable' as const,
        detail: 'that record’s manifest names an image we will not fetch',
        scope: 'record' as const,
      });
    }
    return okAsync(next);
  });
  return { front: front, calls: () => front.mock.calls.length };
}

function clock(start = 1000): { now: () => number; advance: (ms: number) => void } {
  let current = start;
  return {
    now: () => current,
    advance: (ms) => {
      current += ms;
    },
  };
}

describe('an archive that cannot be reached', () => {
  it('is not asked again for every other cover on the page', async () => {
    // The whole grid asks at once. Without a memo, each key independently waits out the proxy's
    // full timeout — twenty-five covers, six at a time, is minutes of a page doing nothing.
    const time = clock();
    const down = archive('unavailable');
    const cache = cachingCoverArt(down, {}, time.now);

    const first = await cache.front('release-group', MBID, 250);
    const neighbour = await cache.front('release-group', OTHER_MBID, 250);

    expect(first.isErr()).toBe(true);
    expect(neighbour.isErr()).toBe(true);
    // One fault, one round trip: the neighbour was answered from the memo, not from the archive.
    expect(down.calls()).toBe(1);
  });

  it('lets a read already on the wire finish, rather than handing it a remembered fault', async () => {
    // Ordering: the in-flight join is asked before the memo. A key whose own answer is already
    // coming has a real one; replacing it with someone else's fault would be inventing a failure.
    const time = clock();
    const { promise, resolve } = Promise.withResolvers<CoverArtAnswer>();
    /** The read the test holds open, so a second caller can join it while it is still running. */
    const held = async (): Promise<Result<CoverArtAnswer, CoverArtUnavailable>> =>
      ok(await promise);
    const inner: CoverArtPort = {
      front: vi.fn((_entity, mbid) =>
        mbid === MBID
          ? new ResultAsync(held())
          : errAsync({
              kind: 'cover-art-unavailable' as const,
              detail: 'down',
              scope: 'archive' as const,
            }),
      ),
    };
    const cache = cachingCoverArt(inner, {}, time.now);

    const slow = cache.front('release-group', MBID, 250);
    await cache.front('release-group', OTHER_MBID, 250);
    const joined = cache.front('release-group', MBID, 250);
    resolve(found(4));

    const first = await slow;
    const second = await joined;
    expect(first.isOk()).toBe(true);
    expect(second.isOk()).toBe(true);
  });

  it('goes back to the archive once the memo has expired', async () => {
    const time = clock();
    const down = archive('unavailable', found(4));
    const cache = cachingCoverArt(down, { unavailableForMs: 60_000 }, time.now);

    await cache.front('release-group', MBID, 250);
    time.advance(60_001);
    const later = await cache.front('release-group', OTHER_MBID, 250);

    // An outage that passed must not keep the covers away: the memo expires on its own, with no
    // one to clear it.
    expect(later.isOk()).toBe(true);
    expect(down.calls()).toBe(2);
  });

  it('does not let one odd record stop the archive being asked about any other', async () => {
    // A manifest naming an image we will not fetch is ordinary archive data, not an outage.
    // Remembering it archive-wide would blank every cover in the house over one release group —
    // and answer 24 healthy identifiers with a fault describing a record nobody asked about.
    const time = clock();
    const odd = archive('record-unavailable');
    const cache = cachingCoverArt(odd, {}, time.now);

    const first = await cache.front('release-group', MBID, 250);
    const neighbour = await cache.front('release-group', OTHER_MBID, 250);

    expect(first.isErr()).toBe(true);
    expect(neighbour.isOk()).toBe(true);
    expect(odd.calls()).toBe(2);
  });

  it('keeps serving art it already holds while the archive is down', async () => {
    // The only copy, dropped at the moment it cannot be replaced, turns a passing outage into a
    // cover that is gone for good.
    const time = clock();
    const cache = cachingCoverArt(archive(found(4), 'unavailable'), { ttlMs: 1000 }, time.now);

    await cache.front('release-group', MBID, 250);
    time.advance(1001);
    await cache.front('release-group', OTHER_MBID, 250);
    const stale = await cache.front('release-group', MBID, 250);

    expect(stale.isOk()).toBe(true);
  });

  it('never turns a fault into an answer of "there is no cover"', async () => {
    const time = clock();
    const cache = cachingCoverArt(archive('unavailable'), {}, time.now);

    const answer = await cache.front('release-group', MBID, 250);

    // Remembering an outage as absence would hide a cover that exists, permanently.
    expect(answer.isErr()).toBe(true);
  });

  it('does not hold back a cover it already has', async () => {
    const time = clock();
    const archived = archive(found(4), 'unavailable');
    const cache = cachingCoverArt(archived, {}, time.now);

    await cache.front('release-group', MBID, 250);
    await cache.front('release-group', OTHER_MBID, 250);
    const cached = await cache.front('release-group', MBID, 250);

    // The memo short-circuits reads, not the answers already remembered.
    expect(cached.isOk()).toBe(true);
  });
});

describe('cachingCoverArt', () => {
  it('forgets the oldest absences rather than keeping a key per identifier ever asked about', async () => {
    // An absence costs no bytes, so the byte budget does not bound it — and most identifiers the
    // archive is asked about have no art at all.
    const inner = archive(
      { kind: 'absent', listedImages: 0 },
      { kind: 'absent', listedImages: 0 },
      { kind: 'absent', listedImages: 0 },
      { kind: 'absent', listedImages: 0 },
    );
    const cached = cachingCoverArt(inner, { maxEntries: 2 }, clock().now);

    // Three identifiers into room for two: the first is forgotten, so asking for it again costs
    // another read while the newest is still answered from memory.
    await cached.front('release-group', 'first', 250);
    await cached.front('release-group', 'second', 250);
    await cached.front('release-group', 'third', 250);
    await cached.front('release-group', 'third', 250);
    await cached.front('release-group', 'first', 250);

    expect(inner.calls()).toBe(4);
  });

  it('holds an answer for exactly as long as it says it will', async () => {
    const inner = archive(found(4), found(8));
    const time = clock();
    const cached = cachingCoverArt(inner, { ttlMs: 1000 }, time.now);

    await cached.front('release-group', MBID, 250);
    time.advance(1000);
    await cached.front('release-group', MBID, 250);

    expect(inner.calls()).toBe(1);
  });

  it('serves two tiles waiting on the same cover with one archive read', async () => {
    // A grid renders twenty-five tiles at once; two of them wanting the same cover must not be two
    // round trips to a volunteer-run archive.
    const inner = archive(found(4), found(8));
    const cached = cachingCoverArt(inner, {}, clock().now);

    const [first, second] = await Promise.all([
      cached.front('release-group', MBID, 250),
      cached.front('release-group', MBID, 250),
    ]);

    expect(first._unsafeUnwrap()).toEqual(second._unsafeUnwrap());
    expect(inner.calls()).toBe(1);
  });

  it('lets a shared read that failed be tried again, rather than remembering the failure', async () => {
    const time = clock();
    const inner = archive('unavailable', found(4));
    const cached = cachingCoverArt(inner, {}, time.now);

    await Promise.all([
      cached.front('release-group', MBID, 250),
      cached.front('release-group', MBID, 250),
    ]);
    // Past the unavailability memo, which is what holds the retry back in the moments after a
    // fault — the failure itself is still not remembered as this cover's answer.
    time.advance(60_001);
    const retried = await cached.front('release-group', MBID, 250);

    expect(retried.isOk()).toBe(true);
  });

  it('serves a second request for the same art without asking the archive again', async () => {
    const inner = archive(found(4));
    const cached = cachingCoverArt(inner, {}, clock().now);

    const first = await cached.front('release-group', MBID, 250);
    const second = await cached.front('release-group', MBID, 250);

    expect(first._unsafeUnwrap()).toEqual(second._unsafeUnwrap());
    expect(inner.calls()).toBe(1);
  });

  it('remembers that a record has no art, so a missing cover is asked about once', async () => {
    const inner = archive({ kind: 'absent', listedImages: 0 });
    const cached = cachingCoverArt(inner, {}, clock().now);

    await cached.front('release-group', MBID, 250);
    const second = await cached.front('release-group', MBID, 250);

    expect(second._unsafeUnwrap()).toEqual({ kind: 'absent', listedImages: 0 });
    expect(inner.calls()).toBe(1);
  });

  it('never remembers a fault as an answer, so art can still turn up later', async () => {
    const time = clock();
    const inner = archive('unavailable', found(4));
    const cached = cachingCoverArt(inner, {}, time.now);

    const failed = await cached.front('release-group', MBID, 250);
    time.advance(60_001);
    const retried = await cached.front('release-group', MBID, 250);

    expect(failed.isErr()).toBe(true);
    // The distinction that matters: the outage held back the ASKING for a minute, and never
    // became the answer "this record has no cover".
    expect(retried._unsafeUnwrap()).toMatchObject({ kind: 'found' });
    expect(inner.calls()).toBe(2);
  });

  it('tells the sizes and the entities apart, so a thumbnail is not served as a full image', async () => {
    const inner = archive(found(4), found(8), found(16));
    const cached = cachingCoverArt(inner, {}, clock().now);

    await cached.front('release-group', MBID, 250);
    await cached.front('release-group', MBID, 500);
    await cached.front('release', MBID, 250);

    expect(inner.calls()).toBe(3);
  });

  it('asks again once a remembered answer is stale', async () => {
    const inner = archive(found(4), found(4));
    const time = clock();
    const cached = cachingCoverArt(inner, { ttlMs: 60_000 }, time.now);

    await cached.front('release-group', MBID, 250);
    time.advance(60_001);
    await cached.front('release-group', MBID, 250);

    expect(inner.calls()).toBe(2);
  });

  it('keeps the cache within its size budget, forgetting what was used longest ago', async () => {
    const inner = archive(found(60), found(60), found(60), found(60));
    const cached = cachingCoverArt(inner, { maxBytes: 100 }, clock().now);

    await cached.front('release-group', MBID, 250); // 60 bytes cached
    await cached.front('release-group', OTHER_MBID, 250); // 120 > 100, so the first is forgotten
    await cached.front('release-group', MBID, 250); // asked again

    expect(inner.calls()).toBe(3);
  });

  it('forgets what was used longest ago, not what arrived first', async () => {
    // Three keys, one of them re-read: a cache that evicted by arrival order would drop the wrong
    // one, and every assertion about "least recently used" would still pass.
    const third = 'ef6e0c0a-9f1f-41af-820a-e3ca91560c13';
    const inner = archive(found(40), found(40), found(40), found(40));
    const cached = cachingCoverArt(inner, { maxBytes: 100 }, clock().now);

    await cached.front('release-group', MBID, 250);
    await cached.front('release-group', OTHER_MBID, 250);
    await cached.front('release-group', MBID, 250); // a hit: MBID is now the most recent
    await cached.front('release-group', third, 250); // over budget: OTHER_MBID should go
    await cached.front('release-group', MBID, 250);

    expect(inner.calls()).toBe(3);
  });

  it('keeps serving art larger than the whole budget without caching it', async () => {
    const inner = archive(found(500), found(500));
    const cached = cachingCoverArt(inner, { maxBytes: 100 }, clock().now);

    const first = await cached.front('release-group', MBID, 500);
    const second = await cached.front('release-group', MBID, 500);

    expect(first._unsafeUnwrap()).toMatchObject({ kind: 'found' });
    expect(second._unsafeUnwrap()).toMatchObject({ kind: 'found' });
    expect(inner.calls()).toBe(2);
  });
});

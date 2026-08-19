import { errAsync, okAsync } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';
import { cachingCoverArt } from './cache.js';
import type { CoverArtAnswer, CoverArtPort } from './port.js';

const MBID = '19847822-1430-3380-9cf1-bc45545b34ac';
const OTHER_MBID = '271faeb3-fdd1-3ebb-80aa-97b3116e9341';

function found(size: number): CoverArtAnswer {
  return {
    kind: 'found',
    image: { contentType: 'image/jpeg', bytes: new Uint8Array(size) },
  };
}

/** A port that answers with the given outcomes in order, counting how often it was asked. */
function archive(
  ...answers: (CoverArtAnswer | 'unavailable')[]
): CoverArtPort & { calls: () => number } {
  const front = vi.fn(() => {
    const next = answers.shift() ?? found(4);
    return next === 'unavailable'
      ? errAsync({ kind: 'cover-art-unavailable' as const, detail: 'down' })
      : okAsync(next);
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
    const inner = archive('unavailable', found(4));
    const cached = cachingCoverArt(inner, {}, clock().now);

    await Promise.all([
      cached.front('release-group', MBID, 250),
      cached.front('release-group', MBID, 250),
    ]);
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
    const inner = archive('unavailable', found(4));
    const cached = cachingCoverArt(inner, {}, clock().now);

    const failed = await cached.front('release-group', MBID, 250);
    const retried = await cached.front('release-group', MBID, 250);

    expect(failed.isErr()).toBe(true);
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

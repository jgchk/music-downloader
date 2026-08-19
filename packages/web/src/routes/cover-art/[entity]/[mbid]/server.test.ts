import { errAsync, okAsync } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';
import { GET } from './+server.js';
import type { CoverArtAnswer, CoverArtPort } from '$lib/server/cover-art/port.js';

const MBID = '19847822-1430-3380-9cf1-bc45545b34ac';
const BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

const foundAnswer: CoverArtAnswer = {
  kind: 'found',
  image: { contentType: 'image/jpeg', bytes: BYTES },
};

function port(answer: CoverArtAnswer | 'unavailable'): CoverArtPort & { front: ReturnType<typeof vi.fn> } {
  const front = vi.fn(() =>
    answer === 'unavailable'
      ? errAsync({ kind: 'cover-art-unavailable' as const, detail: 'down' })
      : okAsync(answer),
  );
  return { front };
}

/** The shape the endpoint reads off a request event; the rest of the event is irrelevant here. */
function event(coverArt: CoverArtPort, params: Record<string, string>, size?: string) {
  return {
    params,
    url: new URL(`https://app.test/cover-art/x/y${size === undefined ? '' : `?size=${size}`}`),
    locals: { coverArt },
  } as never;
}

describe('GET /cover-art/[entity]/[mbid]', () => {
  it('serves the artwork with its own content type', async () => {
    const art = port(foundAnswer);

    const response = await GET(event(art, { entity: 'release-group', mbid: MBID }));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(BYTES);
    expect(art.front).toHaveBeenCalledWith('release-group', MBID, 250);
  });

  it('lets the artwork be cached, since a cover does not change under its identifier', async () => {
    const response = await GET(event(port(foundAnswer), { entity: 'release', mbid: MBID }));

    expect(response.headers.get('cache-control')).toContain('max-age=');
  });

  it('serves the larger size when the detail surface asks for it', async () => {
    const art = port(foundAnswer);

    await GET(event(art, { entity: 'release-group', mbid: MBID }, '500'));

    expect(art.front).toHaveBeenCalledWith('release-group', MBID, 500);
  });

  it('falls back to the grid size when the asked-for size is not one we serve', async () => {
    const art = port(foundAnswer);

    await GET(event(art, { entity: 'release-group', mbid: MBID }, '9999'));

    expect(art.front).toHaveBeenCalledWith('release-group', MBID, 250);
  });

  it('answers "no cover" in a way the browser may remember, so a placeholder settles', async () => {
    const response = await GET(event(port({ kind: 'absent' }), { entity: 'release-group', mbid: MBID }));

    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toContain('max-age=');
  });

  it('answers an unreachable archive as a fault the browser must not remember', async () => {
    const response = await GET(event(port('unavailable'), { entity: 'release-group', mbid: MBID }));

    expect(response.status).toBe(502);
    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  it('refuses an identifier that is not a catalog id, without asking the archive', async () => {
    const art = port(foundAnswer);

    const response = await GET(event(art, { entity: 'release-group', mbid: 'not-an-mbid' }));

    expect(response.status).toBe(400);
    expect(art.front).not.toHaveBeenCalled();
  });

  it('refuses a kind of thing the archive does not hold art for', async () => {
    const art = port(foundAnswer);

    const response = await GET(event(art, { entity: 'artist', mbid: MBID }));

    expect(response.status).toBe(400);
    expect(art.front).not.toHaveBeenCalled();
  });
});

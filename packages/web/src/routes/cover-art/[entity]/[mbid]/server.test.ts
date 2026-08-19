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

function port(
  answer: CoverArtAnswer | 'unavailable',
): CoverArtPort & { front: ReturnType<typeof vi.fn> } {
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
    locals: { coverArt, logger: { warn: vi.fn(), debug: vi.fn() } },
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

    expect(response.headers.get('cache-control')).toBe('private, max-age=2592000');
    // Third-party bytes from our own origin: the declared type must be the only type.
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('serves the larger size when the detail view asks for it', async () => {
    const art = port(foundAnswer);

    await GET(event(art, { entity: 'release-group', mbid: MBID }, '500'));

    expect(art.front).toHaveBeenCalledWith('release-group', MBID, 500);
  });

  it('refuses a size it does not serve rather than answering with a different one', async () => {
    // A blurry cover served for a request that asked for a sharp one is a wrong answer wearing a
    // 200; the caller has no way to learn its URL was never going to work.
    const art = port(foundAnswer);

    const response = await GET(event(art, { entity: 'release-group', mbid: MBID }, '9999'));

    expect(response.status).toBe(400);
    expect(art.front).not.toHaveBeenCalled();
  });

  it('answers "no cover" in a way the browser may remember, so a placeholder settles', async () => {
    const response = await GET(
      event(port({ kind: 'absent', listedImages: 0 }), { entity: 'release-group', mbid: MBID }),
    );

    expect(response.status).toBe(404);
    // Far shorter than the artwork's: the archive GAINING art is the change worth noticing.
    expect(response.headers.get('cache-control')).toBe('private, max-age=3600');
  });

  it('writes down an answer of "no front cover" that came with art in it', async () => {
    const debug = vi.fn();
    const request = {
      params: { entity: 'release-group', mbid: MBID },
      url: new URL('https://app.test/cover-art/x/y'),
      locals: {
        coverArt: port({ kind: 'absent', listedImages: 3 }),
        logger: { warn: vi.fn(), debug },
      },
    } as never;

    const response = await GET(request);

    expect(response.status).toBe(404);
    expect(debug).toHaveBeenCalledWith(
      expect.objectContaining({ listedImages: 3 }),
      'cover art manifest names no front cover',
    );
  });

  it('serves the type the archive gave, not one type for everything', async () => {
    const png = {
      kind: 'found' as const,
      image: { contentType: 'image/png' as const, bytes: BYTES },
    };

    const response = await GET(event(port(png), { entity: 'release-group', mbid: MBID }));

    expect(response.headers.get('content-type')).toBe('image/png');
  });

  it('answers an unreachable archive as a fault the browser must not remember', async () => {
    const response = await GET(event(port('unavailable'), { entity: 'release-group', mbid: MBID }));

    expect(response.status).toBe(502);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('writes down why the archive failed, so an outage is not just missing pictures', async () => {
    const warn = vi.fn();
    const request = {
      params: { entity: 'release-group', mbid: MBID },
      url: new URL('https://app.test/cover-art/x/y'),
      locals: { coverArt: port('unavailable'), logger: { warn, debug: vi.fn() } },
    } as never;

    await GET(request);

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ mbid: MBID, detail: 'down' }),
      'cover art archive unavailable',
    );
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

  it('says out loud that it refused a URL this application emitted', async () => {
    const warn = vi.fn();
    const request = {
      params: { entity: 'artist', mbid: MBID },
      url: new URL('https://app.test/cover-art/x/y'),
      locals: { coverArt: port(foundAnswer), logger: { warn, debug: vi.fn() } },
    } as never;

    await GET(request);

    // A refused URL is a first-party defect, and the page now shows a placeholder rather than the
    // browser's broken-image mark — so this line is the only sign left, and debug is off in prod.
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'artist' }),
      'cover art refused',
    );
  });
});

/* eslint-disable unicorn/prefer-https -- the archive really does hand out cleartext image links;
   these fixtures are its own bytes, and the upgrade to https is what several of these tests pin. */
import { describe, expect, it, vi } from 'vitest';
import { CoverArtArchive } from './adapter.js';
import type { CoverArtAnswer, CoverArtUnavailable } from './port.js';
import type { ResultAsync } from 'neverthrow';

const RELEASE_GROUP = '19847822-1430-3380-9cf1-bc45545b34ac';
const BASE_URL = 'https://caa.test';
const IMAGE_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]); // a JPEG's opening bytes

function manifest(images: unknown[]): Response {
  return Response.json({ images });
}

function jpeg(): Response {
  return new Response(IMAGE_BYTES, { status: 200, headers: { 'Content-Type': 'image/jpeg' } });
}

function fetchStub(...responses: (Response | Error)[]): typeof fetch & ReturnType<typeof vi.fn> {
  const stub = vi.fn();
  for (const response of responses) {
    if (response instanceof Error) stub.mockRejectedValueOnce(response);
    else stub.mockResolvedValueOnce(response);
  }
  return stub as never;
}

const archive = (stub: typeof fetch) => new CoverArtArchive({ baseUrl: BASE_URL }, stub);

async function unwrap(
  pending: ResultAsync<CoverArtAnswer, CoverArtUnavailable>,
): Promise<CoverArtAnswer> {
  const result = await pending;
  return result._unsafeUnwrap();
}

async function unwrapError(
  pending: ResultAsync<CoverArtAnswer, CoverArtUnavailable>,
): Promise<CoverArtUnavailable> {
  const result = await pending;
  return result._unsafeUnwrapErr();
}

describe('CoverArtArchive.front', () => {
  it('reads the front cover at the asked-for size', async () => {
    const stub = fetchStub(
      manifest([
        {
          front: true,
          image: 'http://coverartarchive.org/release/abc/123.jpg',
          thumbnails: { '250': 'http://coverartarchive.org/release/abc/123-250.jpg' },
        },
      ]),
      jpeg(),
    );

    const answer = await unwrap(archive(stub).front('release-group', RELEASE_GROUP, 250));

    expect(answer).toEqual({
      kind: 'found',
      image: { contentType: 'image/jpeg', bytes: IMAGE_BYTES },
    });
    expect(stub.mock.calls[0]?.[0]).toBe(`${BASE_URL}/release-group/${RELEASE_GROUP}`);
    // The archive still hands out cleartext links; the bytes are fetched over https regardless.
    expect(stub.mock.calls[1]?.[0]).toBe('https://coverartarchive.org/release/abc/123-250.jpg');
  });

  it('asks for the larger thumbnail when the larger size is wanted', async () => {
    const stub = fetchStub(
      manifest([
        {
          front: true,
          image: 'http://coverartarchive.org/release/abc/123.jpg',
          thumbnails: {
            '250': 'http://coverartarchive.org/release/abc/123-250.jpg',
            '500': 'http://coverartarchive.org/release/abc/123-500.jpg',
          },
        },
      ]),
      jpeg(),
    );

    await unwrap(archive(stub).front('release-group', RELEASE_GROUP, 500));

    expect(stub.mock.calls[1]?.[0]).toBe('https://coverartarchive.org/release/abc/123-500.jpg');
  });

  it('falls back to the full image when the archive has no thumbnail of that size', async () => {
    const stub = fetchStub(
      manifest([{ front: true, image: 'http://coverartarchive.org/release/abc/123.jpg' }]),
      jpeg(),
    );

    await unwrap(archive(stub).front('release', RELEASE_GROUP, 250));

    expect(stub.mock.calls[0]?.[0]).toBe(`${BASE_URL}/release/${RELEASE_GROUP}`);
    expect(stub.mock.calls[1]?.[0]).toBe('https://coverartarchive.org/release/abc/123.jpg');
  });

  it('falls back to the full image when the archive thumbnails it at other sizes only', async () => {
    const stub = fetchStub(
      manifest([
        {
          front: true,
          image: 'http://coverartarchive.org/release/abc/123.jpg',
          thumbnails: { '250': 'http://coverartarchive.org/release/abc/123-250.jpg' },
        },
      ]),
      jpeg(),
    );

    await unwrap(archive(stub).front('release-group', RELEASE_GROUP, 500));

    expect(stub.mock.calls[1]?.[0]).toBe('https://coverartarchive.org/release/abc/123.jpg');
  });

  it('serves art the archive does not type as the image it almost always is', async () => {
    const untyped = new Response(IMAGE_BYTES, { status: 200 });
    untyped.headers.delete('content-type');
    const stub = fetchStub(
      manifest([{ front: true, image: 'http://coverartarchive.org/release/abc/123.jpg' }]),
      untyped,
    );

    const answer = await unwrap(archive(stub).front('release-group', RELEASE_GROUP, 250));

    expect(answer).toMatchObject({ kind: 'found', image: { contentType: 'image/jpeg' } });
  });

  it('reads a manifest that lists no images at all as absent', async () => {
    const stub = fetchStub(Response.json({}));

    expect(await unwrap(archive(stub).front('release-group', RELEASE_GROUP, 250))).toEqual({
      kind: 'absent',
      listedImages: 0,
    });
  });

  it('identifies this application to the archive', async () => {
    const stub = fetchStub(
      manifest([{ front: true, image: 'http://coverartarchive.org/release/abc/123.jpg' }]),
      jpeg(),
    );

    await unwrap(archive(stub).front('release-group', RELEASE_GROUP, 250));

    const init = stub.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)['User-Agent']).toContain('music-downloader');
  });

  it('will not fetch an image from somewhere the archive does not serve from', async () => {
    // The second hop's address is chosen by the first hop's ANSWER, so it is untrusted input: a
    // drifted or tampered manifest must not be able to point this server at an arbitrary host.
    const stub = fetchStub(manifest([{ front: true, image: 'https://elsewhere.test/pixel.png' }]));

    const failure = await unwrapError(archive(stub).front('release-group', RELEASE_GROUP, 250));

    expect(failure.kind).toBe('cover-art-unavailable');
    expect(stub).toHaveBeenCalledTimes(1);
  });

  it('reports an image the connection dropped part-way, rather than an absent cover', async () => {
    const stub = fetchStub(
      manifest([{ front: true, image: 'https://coverartarchive.org/release/abc/123.jpg' }]),
      new Error('socket hang up'),
    );

    const failure = await unwrapError(archive(stub).front('release-group', RELEASE_GROUP, 250));

    expect(failure.detail).toContain('could not be fetched');
  });

  it.each([
    ['one that is not a URL at all', 'not a url'],
    ['one on a scheme we will not fetch over', 'ftp://coverartarchive.org/release/abc.jpg'],
    ['a host that merely ends in one of ours', 'https://evilcoverartarchive.org/release/abc.jpg'],
    ['a host that merely contains one of ours', 'https://coverartarchive.org.evil.test/a.jpg'],
  ])('will not fetch an image from %s', async (_case, image) => {
    const stub = fetchStub(manifest([{ front: true, image }]));

    const failure = await unwrapError(archive(stub).front('release-group', RELEASE_GROUP, 250));

    expect(failure.kind).toBe('cover-art-unavailable');
    expect(stub).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['the archive’s own host', 'https://coverartarchive.org/release/abc/123.jpg'],
    ['a storage node it fronts', 'https://ia800207.us.archive.org/16/items/mbid-abc/123.jpg'],
  ])('fetches an image the archive names on %s', async (_case, image) => {
    // The archive serves bytes from its own host AND from the archive.org storage nodes it fronts;
    // dropping either would blank every cover in production while every test stayed green.
    const stub = fetchStub(manifest([{ front: true, image }]), jpeg());

    const answer = await unwrap(archive(stub).front('release-group', RELEASE_GROUP, 250));

    expect(answer).toMatchObject({ kind: 'found' });
    expect(stub).toHaveBeenLastCalledWith(image, expect.anything());
  });

  it.each([['image/jpeg'], ['image/png'], ['image/gif'], ['image/webp']])(
    're-serves %s as itself, since it is a type we are willing to serve',
    async (type) => {
      // Every entry in the allowlist is proven, not just one: three of the four could be deleted
      // with the suite green, and the archive's real png/gif/webp covers would be mislabelled.
      const typed = new Response(IMAGE_BYTES, { status: 200, headers: { 'Content-Type': type } });
      const stub = fetchStub(
        manifest([{ front: true, image: 'https://coverartarchive.org/release/abc/123.bin' }]),
        typed,
      );

      const answer = await unwrap(archive(stub).front('release-group', RELEASE_GROUP, 250));

      expect(answer).toMatchObject({ kind: 'found', image: { contentType: type } });
    },
  );

  it('serves only an image type, whatever type the archive declares', async () => {
    const mislabelled = new Response(IMAGE_BYTES, {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    });
    const stub = fetchStub(
      manifest([{ front: true, image: 'http://coverartarchive.org/release/abc/123.jpg' }]),
      mislabelled,
    );

    const answer = await unwrap(archive(stub).front('release-group', RELEASE_GROUP, 250));

    expect(answer).toMatchObject({ kind: 'found', image: { contentType: 'image/jpeg' } });
  });

  it('reads a release group the archive has no art for as absent, not as a fault', async () => {
    const stub = fetchStub(new Response('Not Found', { status: 404 }));

    const answer = await unwrap(archive(stub).front('release-group', RELEASE_GROUP, 250));

    expect(answer).toEqual({ kind: 'absent', listedImages: 0 });
  });

  it('says how much art it saw while finding no front cover, so drift can be told from a back-only scan', async () => {
    // Both are "no cover to show" per request. Only the count distinguishes a record that really
    // has back scans only from a manifest whose `front` flag was renamed — which would otherwise
    // blank every cover in the product, cached, with nothing said anywhere.
    const stub = fetchStub(
      manifest([{ front: false, image: 'http://coverartarchive.org/release/abc/back.jpg' }]),
    );

    const answer = await unwrap(archive(stub).front('release-group', RELEASE_GROUP, 250));

    expect(answer).toEqual({ kind: 'absent', listedImages: 1 });
  });

  it('reports an unreachable archive as unavailable, so absence is never inferred from a fault', async () => {
    const stub = fetchStub(new Error('connection reset'));

    const failure = await unwrapError(archive(stub).front('release-group', RELEASE_GROUP, 250));

    expect(failure.kind).toBe('cover-art-unavailable');
  });

  it.each([
    ['a manifest listing a front cover with no image', 'record'],
    ['a manifest naming an image somewhere we will not fetch from', 'record'],
  ])('files %s as being about the record', async (_case, scope) => {
    const stub = fetchStub(
      Response.json({
        images:
          scope === 'record' && _case.includes('no image')
            ? [{ front: true }]
            : [{ front: true, thumbnails: { '250': 'https://elsewhere.invalid/x.jpg' } }],
      }),
    );

    const failure = await unwrapError(archive(stub).front('release-group', RELEASE_GROUP, 250));

    // One odd record. Treating it as an outage blanks every other cover on the page.
    expect(failure.scope).toBe('record');
  });

  it.each([
    ['answered with something that is not JSON', new Response('nope', { status: 200 })],
    ['answered a shape we cannot read', Response.json({ images: 'not-a-list' })],
  ])('files an archive that %s as being about the archive', async (_case, response) => {
    const failure = await unwrapError(
      archive(fetchStub(response)).front('release-group', RELEASE_GROUP, 250),
    );

    // Drift is archive-wide by nature: the next record will answer the same way.
    expect(failure.scope).toBe('archive');
  });

  it.each([429, 408, 403])('files a %d as the archive talking about itself', async (status) => {
    const stub = fetchStub(new Response('no', { status }));

    const failure = await unwrapError(archive(stub).front('release-group', RELEASE_GROUP, 250));

    // Asking for less, asking for the same again, or refusing us outright — hammering through
    // any of those with 25 more requests makes it worse for every tile.
    expect(failure.scope).toBe('archive');
  });

  it('reports an archive that errors as the archive being unavailable', async () => {
    const stub = fetchStub(new Response('boom', { status: 503 }));

    const failure = await unwrapError(archive(stub).front('release-group', RELEASE_GROUP, 250));

    expect(failure.kind).toBe('cover-art-unavailable');
    // A 5xx is the archive itself, so a caller may reasonably stop asking on everyone's behalf.
    expect(failure.scope).toBe('archive');
  });

  it('reports a refusal of one request as being about that record, not the archive', async () => {
    const stub = fetchStub(new Response('no', { status: 400 }));

    const failure = await unwrapError(archive(stub).front('release-group', RELEASE_GROUP, 250));

    // Otherwise one identifier the archive dislikes would blank every cover in the house.
    expect(failure.scope).toBe('record');
  });

  it('reports an off-contract manifest as unavailable rather than guessing at it', async () => {
    const stub = fetchStub(Response.json({ images: 'not-a-list' }));

    const failure = await unwrapError(archive(stub).front('release-group', RELEASE_GROUP, 250));

    expect(failure.kind).toBe('cover-art-unavailable');
  });

  it('names the step that failed, so a truncated image is not reported as a dead archive', async () => {
    // A real stream that errors part-way, rather than a stubbed method: this is what a dropped
    // connection does, and it stays true however the adapter chooses to read the body.
    const truncated = new Response(
      new ReadableStream({
        start: (controller) => controller.error(new Error('aborted')),
      }),
      { status: 200, headers: { 'Content-Type': 'image/jpeg' } },
    );
    const stub = fetchStub(
      manifest([{ front: true, image: 'http://coverartarchive.org/release/abc/123.jpg' }]),
      truncated,
    );

    const failure = await unwrapError(archive(stub).front('release-group', RELEASE_GROUP, 250));

    expect(failure.detail).toBe('the cover art image could not be read to the end');
  });

  it('refuses to re-serve a script-bearing type as a cover', async () => {
    // The archive's images are user-contributed and re-served from OUR origin: an SVG is a
    // document that runs script, and `nosniff` does not help when the declared type is the
    // dangerous one. Served as bytes, labelled as the default — never echoed.
    const svg = new Response(IMAGE_BYTES, {
      status: 200,
      headers: { 'Content-Type': 'image/svg+xml' },
    });
    const stub = fetchStub(
      manifest([{ front: true, image: 'http://coverartarchive.org/release/abc/123.svg' }]),
      svg,
    );

    const answer = await unwrap(archive(stub).front('release-group', RELEASE_GROUP, 250));

    expect(answer).toMatchObject({ kind: 'found', image: { contentType: 'image/jpeg' } });
  });

  it('serves a type it is willing to serve, parameters and casing and all', async () => {
    const png = new Response(IMAGE_BYTES, {
      status: 200,
      headers: { 'Content-Type': 'IMAGE/PNG; charset=binary' },
    });
    const stub = fetchStub(
      manifest([{ front: true, image: 'http://coverartarchive.org/release/abc/123.png' }]),
      png,
    );

    const answer = await unwrap(archive(stub).front('release-group', RELEASE_GROUP, 250));

    expect(answer).toMatchObject({ kind: 'found', image: { contentType: 'image/png' } });
  });

  it('reports a front cover the archive names no image for, rather than calling it absent', async () => {
    // Absence is remembered for a day and served as a 404: a renamed `image` field would blank
    // every cover in the grid, at two layers, with nothing said anywhere.
    const stub = fetchStub(manifest([{ front: true }]));

    const failure = await unwrapError(archive(stub).front('release-group', RELEASE_GROUP, 250));

    expect(failure.detail).toBe(
      'the cover art archive listed a front cover with no image to fetch',
    );
  });

  it('reports an archive answering with something other than JSON as unavailable', async () => {
    const stub = fetchStub(
      new Response('<html>maintenance</html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }),
    );

    const failure = await unwrapError(archive(stub).front('release-group', RELEASE_GROUP, 250));

    expect(failure.detail).toContain('JSON');
  });

  it('reports a readable manifest whose image will not load as unavailable, not as absent', async () => {
    const stub = fetchStub(
      manifest([{ front: true, image: 'http://coverartarchive.org/release/abc/123.jpg' }]),
      new Response('gone', { status: 500 }),
    );

    const failure = await unwrapError(archive(stub).front('release-group', RELEASE_GROUP, 250));

    expect(failure.kind).toBe('cover-art-unavailable');
  });
});

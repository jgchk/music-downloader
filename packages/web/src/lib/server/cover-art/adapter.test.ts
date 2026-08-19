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

function image(): Response {
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
          image: 'https://ia.test/full.jpg',
          thumbnails: { '250': 'https://ia.test/250.jpg' },
        },
      ]),
      image(),
    );

    const answer = await unwrap(archive(stub).front('release-group', RELEASE_GROUP, 250));

    expect(answer).toEqual({
      kind: 'found',
      image: { contentType: 'image/jpeg', bytes: IMAGE_BYTES },
    });
    expect(stub.mock.calls[0]?.[0]).toBe(`${BASE_URL}/release-group/${RELEASE_GROUP}`);
    expect(stub.mock.calls[1]?.[0]).toBe('https://ia.test/250.jpg');
  });

  it('asks for the larger thumbnail when the larger size is wanted', async () => {
    const stub = fetchStub(
      manifest([
        {
          front: true,
          image: 'https://ia.test/full.jpg',
          thumbnails: { '250': 'https://ia.test/250.jpg', '500': 'https://ia.test/500.jpg' },
        },
      ]),
      image(),
    );

    await unwrap(archive(stub).front('release-group', RELEASE_GROUP, 500));

    expect(stub.mock.calls[1]?.[0]).toBe('https://ia.test/500.jpg');
  });

  it('falls back to the full image when the archive has no thumbnail of that size', async () => {
    const stub = fetchStub(manifest([{ front: true, image: 'https://ia.test/full.jpg' }]), image());

    await unwrap(archive(stub).front('release', RELEASE_GROUP, 250));

    expect(stub.mock.calls[0]?.[0]).toBe(`${BASE_URL}/release/${RELEASE_GROUP}`);
    expect(stub.mock.calls[1]?.[0]).toBe('https://ia.test/full.jpg');
  });

  it('falls back to the full image when the archive thumbnails it at other sizes only', async () => {
    const stub = fetchStub(
      manifest([
        {
          front: true,
          image: 'https://ia.test/full.jpg',
          thumbnails: { '250': 'https://ia.test/250.jpg' },
        },
      ]),
      image(),
    );

    await unwrap(archive(stub).front('release-group', RELEASE_GROUP, 500));

    expect(stub.mock.calls[1]?.[0]).toBe('https://ia.test/full.jpg');
  });

  it('serves art the archive does not type as the image it almost always is', async () => {
    const untyped = new Response(IMAGE_BYTES, { status: 200 });
    untyped.headers.delete('content-type');
    const stub = fetchStub(manifest([{ front: true, image: 'https://ia.test/full.jpg' }]), untyped);

    const answer = await unwrap(archive(stub).front('release-group', RELEASE_GROUP, 250));

    expect(answer).toMatchObject({ kind: 'found', image: { contentType: 'image/jpeg' } });
  });

  it('reads a manifest that lists no images at all as absent', async () => {
    const stub = fetchStub(Response.json({}));

    expect(await unwrap(archive(stub).front('release-group', RELEASE_GROUP, 250))).toEqual({
      kind: 'absent',
    });
  });

  it('identifies this application to the archive', async () => {
    const stub = fetchStub(manifest([{ front: true, image: 'https://ia.test/full.jpg' }]), image());

    await unwrap(archive(stub).front('release-group', RELEASE_GROUP, 250));

    const init = stub.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)['User-Agent']).toContain('music-downloader');
  });

  it('reads a release group the archive has no art for as absent, not as a fault', async () => {
    const stub = fetchStub(new Response('Not Found', { status: 404 }));

    const answer = await unwrap(archive(stub).front('release-group', RELEASE_GROUP, 250));

    expect(answer).toEqual({ kind: 'absent' });
  });

  it('reads art with no front cover as absent — a back cover is not what a picker shows', async () => {
    const stub = fetchStub(manifest([{ front: false, image: 'https://ia.test/back.jpg' }]));

    const answer = await unwrap(archive(stub).front('release-group', RELEASE_GROUP, 250));

    expect(answer).toEqual({ kind: 'absent' });
  });

  it('reports an unreachable archive as unavailable, so absence is never inferred from a fault', async () => {
    const stub = fetchStub(new Error('connection reset'));

    const failure = await unwrapError(archive(stub).front('release-group', RELEASE_GROUP, 250));

    expect(failure.kind).toBe('cover-art-unavailable');
  });

  it('reports an archive that errors as unavailable', async () => {
    const stub = fetchStub(new Response('boom', { status: 503 }));

    const failure = await unwrapError(archive(stub).front('release-group', RELEASE_GROUP, 250));

    expect(failure.kind).toBe('cover-art-unavailable');
  });

  it('reports an off-contract manifest as unavailable rather than guessing at it', async () => {
    const stub = fetchStub(Response.json({ images: 'not-a-list' }));

    const failure = await unwrapError(archive(stub).front('release-group', RELEASE_GROUP, 250));

    expect(failure.kind).toBe('cover-art-unavailable');
  });

  it('reports a readable manifest whose image will not load as unavailable, not as absent', async () => {
    const stub = fetchStub(
      manifest([{ front: true, image: 'https://ia.test/full.jpg' }]),
      new Response('gone', { status: 500 }),
    );

    const failure = await unwrapError(archive(stub).front('release-group', RELEASE_GROUP, 250));

    expect(failure.kind).toBe('cover-art-unavailable');
  });
});

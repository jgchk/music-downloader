import { describe, expect, it, vi } from 'vitest';
import type { RequestEvent, ResolveOptions } from '@sveltejs/kit';

const bootRuntimes = vi.fn(() => Promise.resolve());
const facadesOf = vi.fn(() => ({ downloader: {}, importer: {} }));
vi.mock('$env/dynamic/private', () => ({ env: { LIBRARY_ROOT: '/library' } }));
vi.mock('$lib/server/runtime.js', () => ({
  bootRuntimes: (...args: unknown[]) => bootRuntimes(...(args as [])),
  facadesOf: () => facadesOf(),
}));

const { handle, init } = await import('./hooks.server.js');

describe('server hooks', () => {
  it('init boots the composed runtimes (awaited before any request is served)', async () => {
    await init();
    expect(bootRuntimes).toHaveBeenCalledOnce();
    // Boots from SvelteKit's runtime env (which carries `.env` in dev), not an empty process.env.
    expect(bootRuntimes).toHaveBeenCalledWith({ LIBRARY_ROOT: '/library' });
  });

  it('handle injects the facades into locals for every server route', async () => {
    const event = { locals: {} } as unknown as RequestEvent;
    const response = new Response('ok');
    const resolve = vi.fn((_event: RequestEvent, _opts?: ResolveOptions) =>
      Promise.resolve(response),
    );

    const result = await handle({ event, resolve });

    expect(event.locals.facades).toEqual({ downloader: {}, importer: {} });
    expect(resolve).toHaveBeenCalledWith(event);
    expect(result).toBe(response);
  });
});

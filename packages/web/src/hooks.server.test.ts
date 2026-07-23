import { describe, expect, it, vi } from 'vitest';
import type { RequestEvent, ResolveOptions } from '@sveltejs/kit';

const bootRuntimes = vi.fn(() => Promise.resolve());
const facadesOf = vi.fn(() => ({ downloader: {}, importer: {} }));
const logger = { warn: vi.fn(), error: vi.fn() };
vi.mock('$env/dynamic/private', () => ({ env: { LIBRARY_ROOT: '/library' } }));
vi.mock('$lib/server/runtime.js', () => ({
  bootRuntimes: (...args: unknown[]) => bootRuntimes(...(args as [])),
  facadesOf: () => facadesOf(),
  loggerOf: () => logger,
}));

const { handle, handleError, init } = await import('./hooks.server.js');

describe('server hooks', () => {
  it('init boots the composed runtimes (awaited before any request is served)', async () => {
    await init();
    expect(bootRuntimes).toHaveBeenCalledOnce();
    // Boots from SvelteKit's runtime env (which carries `.env` in dev), not an empty process.env.
    expect(bootRuntimes).toHaveBeenCalledWith({ LIBRARY_ROOT: '/library' });
  });

  it('handle injects the facades and the logger into locals for every server route', async () => {
    const event = { locals: {} } as unknown as RequestEvent;
    const response = new Response('ok');
    const resolve = vi.fn((_event: RequestEvent, _opts?: ResolveOptions) =>
      Promise.resolve(response),
    );

    const result = await handle({ event, resolve });

    expect(event.locals.facades).toEqual({ downloader: {}, importer: {} });
    expect(event.locals.logger).toBe(logger);
    expect(resolve).toHaveBeenCalledWith(event);
    expect(result).toBe(response);
  });

  it('handleError records the fault through the pino root with an id + request context and returns a shaped, id-carrying message', () => {
    const boom = new Error('projection read failed');
    const event = {
      route: { id: '/acquisitions/[id]' },
      request: { method: 'GET' },
    } as unknown as RequestEvent;

    const shaped = handleError({ error: boom, event, status: 500, message: 'Internal Error' }) as {
      message: string;
      errorId: string;
    };

    expect(shaped.errorId).toMatch(/\S/);
    expect(shaped.message).toContain('Internal Error');
    expect(shaped.message).toContain(shaped.errorId);
    expect(logger.error).toHaveBeenCalledOnce();
    expect(logger.error).toHaveBeenCalledWith(
      {
        errorId: shaped.errorId,
        routeId: '/acquisitions/[id]',
        method: 'GET',
        status: 500,
        err: boom,
      },
      expect.stringMatching(/\S/),
    );
  });
});

import { describe, expect, it, vi } from 'vitest';
import { actions, load } from './+page.server.js';

describe('logout', () => {
  it('clears the session cookie and lands on the login page', () => {
    const deleted: [string, Record<string, unknown>][] = [];
    const event = {
      cookies: {
        delete: (name: string, options: Record<string, unknown>) =>
          void deleted.push([name, options]),
      },
    } as never;
    expect(() => actions.default!(event)).toThrow(
      expect.objectContaining({ status: 303, location: '/login' }),
    );
    // Deletion must name the same path the login callback set, or the cookie survives.
    expect(deleted).toEqual([['__Host-md_session', { path: '/', secure: true }]]);
  });

  it('sends a stray GET of /logout home instead of serving a page', () => {
    expect(() => load(vi.fn() as never)).toThrow(
      expect.objectContaining({ status: 303, location: '/' }),
    );
  });
});

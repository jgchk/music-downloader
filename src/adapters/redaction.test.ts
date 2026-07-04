import { describe, expect, it } from 'vitest';
import { createLogger } from '../application/logging/logger.js';
import type { Logger } from '../application/logging/logger.js';
import { createTarget } from '../domain/target/target.js';
import type { HttpClient, HttpResponse } from './support/http.js';
import { SlskdClient } from './slskd/client.js';
import { SlskdSearch } from './slskd/search.js';
import type { Timer } from './slskd/timer.js';

/**
 * D15 guardrail: adapters log their I/O at `debug`, and the pino redaction config guarantees that
 * credentials (slskd API key, auth tokens) and file contents never reach the log stream. This is
 * the defensive floor — even if a future adapter logs a sensitive-looking field, it is censored.
 */

function capture(): { logger: Logger; output: () => string } {
  let output = '';
  const logger = createLogger({
    level: 'debug',
    destination: {
      write: (chunk: string) => {
        output += chunk;
        return true;
      },
    },
  });
  return { logger, output: () => output };
}

function json(body: unknown): HttpResponse {
  return { status: 200, body: JSON.stringify(body) };
}

const immediateTimer: Timer = { now: () => 0, sleep: () => Promise.resolve() };

describe('adapter logging redaction (D15)', () => {
  it('censors credential-shaped fields and file contents', () => {
    const { logger, output } = capture();

    logger.debug(
      {
        apiKey: 'topsecret-key',
        headers: { authorization: 'Bearer abc123' },
        fileContents: 'RAW_AUDIO_BYTES',
      },
      'adapter io',
    );

    const emitted = output();
    expect(emitted).toContain('[REDACTED]');
    expect(emitted).not.toContain('topsecret-key');
    expect(emitted).not.toContain('Bearer abc123');
    expect(emitted).not.toContain('RAW_AUDIO_BYTES');
  });

  it('never emits the slskd API key while logging search I/O at debug', async () => {
    const { logger, output } = capture();
    const http: HttpClient = {
      send: ({ method, url }) => {
        if (method === 'POST') return Promise.resolve(json({ id: 's1' }));
        if (url.endsWith('/responses')) return Promise.resolve(json([]));
        return Promise.resolve(json({ isComplete: true }));
      },
    };
    const search = new SlskdSearch(
      logger,
      new SlskdClient(http, { apiKey: 'topsecret-key' }),
      immediateTimer,
    );
    const target = createTarget({
      type: 'album',
      artist: 'Artist',
      title: 'Album',
      tracks: [{ position: 1, title: 'T', durationMs: 1000 }],
    })._unsafeUnwrap();

    await search.search(target, 1);

    const emitted = output();
    expect(emitted).toContain('creating slskd search');
    expect(emitted).not.toContain('topsecret-key');
  });
});

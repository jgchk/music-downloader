import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createLogger } from '../../application/logging/logger.js';
import { testWiring } from '../__fixtures__/wiring.js';
import { buildHttpApp } from './app.js';

/**
 * D15/8.6: every request carries a request id (an inbound `x-request-id` is honored for trace
 * propagation, otherwise one is minted), and the edge emits an `acquisitionId`-correlated line so
 * an acquisition's journey is traceable from the HTTP boundary inward.
 */
function capturingLogger(): { logger: ReturnType<typeof createLogger>; lines: () => string[] } {
  let buffer = '';
  const logger = createLogger({
    level: 'info',
    destination: {
      write: (chunk: string) => {
        buffer += chunk;
        return true;
      },
    },
  });
  return {
    logger,
    lines: () =>
      buffer
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as string),
  };
}

const descriptorBody = {
  request: { kind: 'descriptor', targetType: 'album', artist: 'A', title: 'T' },
};

describe('HTTP request correlation', () => {
  let app: FastifyInstance;
  let capture: ReturnType<typeof capturingLogger>;

  beforeEach(async () => {
    capture = capturingLogger();
    app = await buildHttpApp(testWiring().deps, capture.logger, '0.0.0-test');
  });

  afterEach(async () => {
    await app.close();
  });

  it('correlates the edge submission log with a minted request id', async () => {
    await app.inject({ method: 'POST', url: '/api/v1/acquisitions', payload: descriptorBody });

    const edge = capture
      .lines()
      .find((line) => (line as unknown as { msg: string }).msg === 'acquisition submitted');
    expect(edge).toMatchObject({ acquisitionId: 'acq-1', reqId: 'req-1' });
  });

  it('honors an inbound x-request-id as the correlation id', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/acquisitions',
      headers: { 'x-request-id': 'trace-xyz' },
      payload: descriptorBody,
    });

    const edge = capture
      .lines()
      .find((line) => (line as unknown as { msg: string }).msg === 'acquisition submitted');
    expect(edge).toMatchObject({ reqId: 'trace-xyz' });
  });
});

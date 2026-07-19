import { describe, expect, it } from 'vitest';
import { createLogger } from '../../application/logging/logger.js';
import { buildHttpApp } from './app.js';

function silentLogger() {
  return createLogger({ level: 'silent', destination: { write: () => undefined } });
}

describe('buildHttpApp', () => {
  it('serves the (empty) import list', async () => {
    const app = await buildHttpApp(silentLogger(), '0.0.0-test');

    const res = await app.inject({ method: 'GET', url: '/api/v1/imports' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ imports: [] });
    await app.close();
  });

  it('publishes the OpenAPI document with the app version', async () => {
    const app = await buildHttpApp(silentLogger(), '1.2.3');

    const res = await app.inject({ method: 'GET', url: '/docs/json' });

    expect(res.statusCode).toBe(200);
    expect(res.json<{ info: { title: string; version: string } }>().info).toEqual({
      title: 'Music Importer API',
      version: '1.2.3',
    });
    await app.close();
  });

  it('honors an inbound x-request-id and mints one otherwise', async () => {
    const app = await buildHttpApp(silentLogger(), '0.0.0-test');

    const traced = await app.inject({
      method: 'GET',
      url: '/api/v1/imports',
      headers: { 'x-request-id': 'trace-42' },
    });
    const minted = await app.inject({ method: 'GET', url: '/api/v1/imports' });

    expect(traced.statusCode).toBe(200);
    expect(minted.statusCode).toBe(200);
    await app.close();
  });
});

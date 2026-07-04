import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { silentLogger } from '../../application/__fixtures__/fakes.js';
import { testWiring } from '../__fixtures__/wiring.js';
import { buildHttpApp } from './app.js';

/**
 * The breaking-change guard (D12/D14): the generated OpenAPI document is the single derived
 * contract for the HTTP surface. Snapshotting the whole document fails CI on any drift — a removed
 * endpoint, a renamed field, a changed type — so a breaking change cannot ship under `/api/v1`
 * unless the snapshot is deliberately updated.
 */
describe('OpenAPI contract', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildHttpApp(testWiring().deps, silentLogger());
  });

  afterEach(async () => {
    await app.close();
  });

  it('exposes every v1 acquisition endpoint under the version prefix', () => {
    const spec = app.swagger() as { openapi: string; paths: Record<string, unknown> };

    expect(spec.openapi).toMatch(/^3\./);
    expect(Object.keys(spec.paths).sort()).toEqual([
      '/api/v1/acquisitions',
      '/api/v1/acquisitions/{id}',
      '/api/v1/acquisitions/{id}/cancel',
      '/api/v1/acquisitions/{id}/progress',
    ]);
  });

  it('matches the published contract snapshot', () => {
    expect(app.swagger()).toMatchSnapshot();
  });

  it('serves the OpenAPI JSON document', async () => {
    const res = await app.inject({ method: 'GET', url: '/docs/json' });

    expect(res.statusCode).toBe(200);
    expect(res.json<{ openapi: string }>().openapi).toMatch(/^3\./);
  });
});

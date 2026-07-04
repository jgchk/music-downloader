import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { silentLogger } from '../../application/__fixtures__/fakes.js';
import { infraError } from '../../application/ports/errors.js';
import { testWiring } from '../__fixtures__/wiring.js';
import type { TestWiring } from '../__fixtures__/wiring.js';
import { buildHttpApp, statusForCommandError } from './app.js';

const descriptorBody = {
  request: { kind: 'descriptor', targetType: 'album', artist: 'A', title: 'T' },
};

describe('statusForCommandError', () => {
  it('maps infra faults to 500 and everything else to 409', () => {
    expect(statusForCommandError(infraError('append', 'boom'))).toBe(500);
    expect(statusForCommandError({ kind: 'AlreadyExists' })).toBe(409);
    expect(
      statusForCommandError({ kind: 'ConcurrencyConflict', streamId: 'a', expectedVersion: 0 }),
    ).toBe(409);
  });
});

describe('HTTP API v1', () => {
  let wiring: TestWiring;
  let app: FastifyInstance;

  beforeEach(async () => {
    wiring = testWiring();
    app = await buildHttpApp(wiring.deps, silentLogger());
  });

  afterEach(async () => {
    await app.close();
  });

  async function submit(): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/acquisitions',
      payload: descriptorBody,
    });
    wiring.sync();
    return res.json<{ acquisitionId: string }>().acquisitionId;
  }

  it('accepts a submission and returns the id and status URL', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/acquisitions',
      payload: descriptorBody,
    });

    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({
      acquisitionId: 'acq-1',
      statusUrl: '/api/v1/acquisitions/acq-1',
    });
  });

  it('rejects an inconsistent quality policy with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/acquisitions',
      payload: { ...descriptorBody, qualityPolicy: { order: ['LOSSLESS'], floor: 'UNKNOWN' } },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('InvalidPolicy');
  });

  it('surfaces an event-store fault as 500', async () => {
    wiring.store.failReads = true;

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/acquisitions',
      payload: descriptorBody,
    });

    expect(res.statusCode).toBe(500);
    expect(res.json<{ error: string }>().error).toBe('InfraError');
  });

  it('returns a submitted acquisition status and lists it', async () => {
    const id = await submit();

    const status = await app.inject({ method: 'GET', url: `/api/v1/acquisitions/${id}` });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({ acquisitionId: id, status: 'Pending' });

    const list = await app.inject({ method: 'GET', url: '/api/v1/acquisitions' });
    expect(list.json<{ acquisitions: unknown[] }>().acquisitions).toHaveLength(1);
  });

  it('returns 404 for an unknown acquisition status', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/acquisitions/missing' });

    expect(res.statusCode).toBe(404);
  });

  it('returns live progress when present and 404 otherwise', async () => {
    const id = await submit();
    wiring.progress.update(id, {
      percent: 42,
      bytesTransferred: 42,
      bytesTotal: 100,
      queuePosition: 1,
    });

    const found = await app.inject({ method: 'GET', url: `/api/v1/acquisitions/${id}/progress` });
    expect(found.statusCode).toBe(200);
    expect(found.json()).toMatchObject({ percent: 42, queuePosition: 1 });

    const missing = await app.inject({
      method: 'GET',
      url: '/api/v1/acquisitions/missing/progress',
    });
    expect(missing.statusCode).toBe(404);
  });

  it('cancels a known acquisition and 404s an unknown one', async () => {
    const id = await submit();

    const cancelled = await app.inject({
      method: 'POST',
      url: `/api/v1/acquisitions/${id}/cancel`,
    });
    expect(cancelled.statusCode).toBe(202);
    expect(cancelled.json()).toEqual({ acquisitionId: id });

    const missing = await app.inject({
      method: 'POST',
      url: '/api/v1/acquisitions/missing/cancel',
    });
    expect(missing.statusCode).toBe(404);
  });

  it('surfaces a store fault during cancellation as 500', async () => {
    const id = await submit();
    wiring.store.failReads = true;

    const res = await app.inject({ method: 'POST', url: `/api/v1/acquisitions/${id}/cancel` });

    expect(res.statusCode).toBe(500);
  });
});

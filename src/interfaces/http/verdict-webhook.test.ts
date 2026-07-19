import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { InjectOptions } from 'fastify';
import { silentLogger } from '../../application/__fixtures__/fakes.js';
import {
  fulfilledHistory,
  matchingCandidate,
} from '../../domain/acquisition/__fixtures__/acquisition-fixtures.js';
import { testWiring } from '../__fixtures__/wiring.js';
import type { TestWiring } from '../__fixtures__/wiring.js';
import { buildHttpApp } from './app.js';
import { DeliveryDedupe, VERDICT_WEBHOOK_PATH } from './verdict-webhook.js';

const KEY = Buffer.from('receiver-signing-key-0123456789ab');
const SECRET = `whsec_${KEY.toString('base64')}`;
// testWiring's fixed clock — deliveries must be timestamped inside its replay window.
const NOW_SECONDS = Math.floor(new Date('2026-07-03T12:00:00.000Z').getTime() / 1000);

const a = matchingCandidate('a');
const b = matchingCandidate('b');

const REJECTION_BODY = JSON.stringify({
  type: 'import.rejected', // the sender's envelope fields are not ours to validate
  timestamp: '2026-07-03T11:59:00.000Z',
  data: {
    acquisitionId: 'acq-9',
    candidate: { username: a.identity.username, path: a.identity.path, sizeBytes: 1000 },
    verdict: 'rejected',
    reasons: ['corrupt stub'],
    matchDistance: 0.42, // unknown fields are ignored
  },
});

function delivery(
  id: string,
  body: string,
  overrides: { timestampOffset?: number; signature?: string } = {},
): InjectOptions {
  const timestamp = String(NOW_SECONDS + (overrides.timestampOffset ?? 0));
  const signature =
    overrides.signature ??
    `v1,${createHmac('sha256', KEY).update(`${id}.${timestamp}.${body}`).digest('base64')}`;
  return {
    method: 'POST',
    url: VERDICT_WEBHOOK_PATH,
    headers: {
      'content-type': 'application/json',
      'webhook-id': id,
      'webhook-timestamp': timestamp,
      'webhook-signature': signature,
    },
    payload: body,
  };
}

describe('the verdict webhook receiver', () => {
  let wiring: TestWiring;
  let app: FastifyInstance;
  const cleanups: (() => Promise<void>)[] = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  async function start(secret: string | null = SECRET): Promise<void> {
    wiring = testWiring();
    await wiring.store
      .append('acq-9', 0, fulfilledHistory([a, b]), { acquisitionId: 'acq-9', occurredAt: 't' })
      .unwrapOr([]);
    app = await buildHttpApp(
      wiring.deps,
      silentLogger(),
      '0.0.0-test',
      secret === null ? {} : { verdictWebhook: { secret } },
    );
    cleanups.push(() => app.close());
  }

  function appendedTypes(): readonly string[] {
    return wiring.store.all().map((entry) => entry.type);
  }

  it('revives the acquisition on a correctly signed rejection and acknowledges', async () => {
    await start();
    const res = await app.inject(delivery('msg-1', REJECTION_BODY));

    expect(res.statusCode).toBe(204);
    expect(appendedTypes()).toContain('FulfillmentRejected');
    expect(appendedTypes()).toContain('CandidateSelected');

    wiring.sync();
    const view = wiring.status.get('acq-9')!;
    expect(view.status).toBe('Downloading');
    expect(view.history.at(-1)).toMatchObject({ kind: 'selected', candidate: b.identity });
    expect(view.history.at(-2)).toEqual({
      kind: 'fulfillment-rejected',
      candidate: a.identity,
      reasons: ['corrupt stub'],
    });
  });

  it('rejects a missing or invalid signature before any command is issued', async () => {
    await start();
    const before = appendedTypes().length;

    const unsigned = await app.inject({
      method: 'POST',
      url: VERDICT_WEBHOOK_PATH,
      headers: { 'content-type': 'application/json' },
      payload: REJECTION_BODY,
    });
    expect(unsigned.statusCode).toBe(401);

    const forged = await app.inject(
      delivery('msg-1', REJECTION_BODY, { signature: 'v1,Zm9yZ2VkLXNpZ25hdHVyZQ==' }),
    );
    expect(forged.statusCode).toBe(401);

    const stale = await app.inject(delivery('msg-1', REJECTION_BODY, { timestampOffset: -3600 }));
    expect(stale.statusCode).toBe(401);

    expect(appendedTypes()).toHaveLength(before);
  });

  it('acknowledges a redelivered webhook-id without reapplying it', async () => {
    await start();
    await app.inject(delivery('msg-1', REJECTION_BODY));
    const afterFirst = appendedTypes();

    const redelivered = await app.inject(delivery('msg-1', REJECTION_BODY));
    expect(redelivered.statusCode).toBe(204);
    expect(appendedTypes()).toEqual(afterFirst);
  });

  it('converges a fresh delivery whose candidate is stale — acknowledged, state unchanged', async () => {
    await start();
    const staleBody = JSON.stringify({
      data: { acquisitionId: 'acq-9', candidate: b.identity, verdict: 'rejected' },
    });
    const before = appendedTypes().length;

    const res = await app.inject(delivery('msg-2', staleBody));
    expect(res.statusCode).toBe(204);
    expect(appendedTypes()).toHaveLength(before);
  });

  it('rejects a signed but unreadable payload', async () => {
    await start();
    const notJson = await app.inject(delivery('msg-3', 'not json at all'));
    expect(notJson.statusCode).toBe(400);

    const unknownVerdict = await app.inject(
      delivery(
        'msg-4',
        JSON.stringify({
          data: { acquisitionId: 'acq-9', candidate: a.identity, verdict: 'accepted' },
        }),
      ),
    );
    expect(unknownVerdict.statusCode).toBe(400);
  });

  it('surfaces a store fault as 500 and leaves the delivery unconsumed for retry', async () => {
    await start();
    wiring.store.failReads = true;
    const failed = await app.inject(delivery('msg-5', REJECTION_BODY));
    expect(failed.statusCode).toBe(500);

    wiring.store.failReads = false;
    const retried = await app.inject(delivery('msg-5', REJECTION_BODY));
    expect(retried.statusCode).toBe(204);
    expect(appendedTypes()).toContain('FulfillmentRejected');
  });

  it('is not registered at all when no receiver secret is configured (config-dormant)', async () => {
    await start(null);
    const res = await app.inject(delivery('msg-1', REJECTION_BODY));
    expect(res.statusCode).toBe(404);
  });
});

describe('DeliveryDedupe', () => {
  it('remembers ids up to its capacity, evicting the oldest first', () => {
    const dedupe = new DeliveryDedupe(2);
    dedupe.add('one');
    dedupe.add('two');
    expect(dedupe.has('one')).toBe(true);

    dedupe.add('three'); // evicts 'one'
    expect(dedupe.has('one')).toBe(false);
    expect(dedupe.has('two')).toBe(true);
    expect(dedupe.has('three')).toBe(true);
  });

  it('degenerates gracefully at zero capacity: nothing to evict, ids still recorded', () => {
    const dedupe = new DeliveryDedupe(0);
    dedupe.add('one');
    expect(dedupe.has('one')).toBe(true);
  });
});

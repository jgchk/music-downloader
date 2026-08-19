import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EffectLander } from './effect-lander.js';
import type { EffectPorts } from './interpreter.js';
import {
  FakeDeadLetterStore,
  FakeEventStore,
  fixedClock,
  silentLogger,
} from '../__fixtures__/fakes.js';
import { appendMetadata, testScope } from '../__fixtures__/correlation.js';
import { infraError } from '../ports/errors.js';
import { StalledReadModel } from '../projections/read-models.js';
import { DEFAULT_DOWNLOAD_POLICY } from '../../domain/policy/policies.js';
import type { DownloadEvent } from '../../domain/download/events.js';
import {
  matchingCandidate,
  startedHistory,
} from '../../domain/download/__fixtures__/download-fixtures.js';

/**
 * Where a permanently failed or budget-exhausted effect comes to rest (reactor-durability D2).
 * The reactor decides WHEN to land; these specs pin WHERE — which modeled business failure each
 * effect degrades to, so a spent budget advances the download instead of freezing it.
 */

function stubPorts(): EffectPorts {
  return {
    metadata: { resolve: vi.fn() },
    search: { search: vi.fn() },
    download: { start: vi.fn(), abort: vi.fn() },
    probe: { probe: vi.fn() },
    library: { import: vi.fn(), discardStaging: vi.fn() },
  };
}

let store: FakeEventStore;
let deadLetters: FakeDeadLetterStore;
let stalled: StalledReadModel;

beforeEach(() => {
  store = new FakeEventStore();
  deadLetters = new FakeDeadLetterStore();
  stalled = new StalledReadModel();
});

function lander(): EffectLander {
  return new EffectLander({
    interpreter: { store, clock: fixedClock(), ports: stubPorts() },
    deadLetters,
    stalled,
    clock: fixedClock(),
    logger: silentLogger(),
    subscription: 'downloader:reactor',
  });
}

async function seed(history: readonly DownloadEvent[]): Promise<void> {
  await store.append('acq-1', 0, history, appendMetadata('acq-1', 't'));
}

function downloadFailure(): Extract<DownloadEvent, { type: 'TryFailed' }> | undefined {
  return store.all().find((entry) => entry.type === 'TryFailed')?.event as
    Extract<DownloadEvent, { type: 'TryFailed' }> | undefined;
}

describe('EffectLander', () => {
  it('lands a download whose retry budget is spent as a stalled attempt on that candidate', async () => {
    // The budget was spent on the short ensure-start, so the transfer may never have begun: the
    // download has to move down the candidate ladder, and the reason it moved is what an
    // operator reads. `Cancelled` would say a human stopped it; `Stalled` says the source did.
    const candidate = matchingCandidate('a');
    await seed(startedHistory([candidate, matchingCandidate('b')]));
    const stored = store.all().at(-1)!;

    const didLand = await lander().land(
      stored,
      { type: 'Download', candidate, policy: DEFAULT_DOWNLOAD_POLICY },
      infraError('slskd.enqueue', 'boom'),
      3,
      testScope(),
    );

    expect(didLand).toBe(true);
    expect(downloadFailure()).toMatchObject({
      candidate: candidate.identity,
      reason: 'Stalled',
    });
    // Degraded through the normal command path, so nothing was parked and nothing is stalled.
    expect(deadLetters.letters).toEqual([]);
    expect(stalled.isStalled('acq-1')).toBe(false);
  });
});

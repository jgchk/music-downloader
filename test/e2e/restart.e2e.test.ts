import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  BASE_URL,
  DATA_DIR,
  IMPORTER_DB,
  MBID,
  countEvents,
  pollForEvent,
  pollUntilTerminal,
  reviewQueueEmpty,
  seedStagedFixture,
  submitAcquisition,
  waitForOk,
} from './helpers.js';

/**
 * Restart resilience (merge-modular-monolith task 8.2): the process dies AFTER the downloader has
 * committed fulfilment but BEFORE the importer finishes, and the import still completes — exactly
 * once — purely from the durable stores and the subscription checkpoint, with no re-submission.
 *
 * The window is forced deterministically: run.sh started this phase's container with
 * BRIDGE_PYTHON pointed at a wrapper that blocks while a flag file exists, so the import can be
 * requested (seam handoff committed) but never propose. The test then kills the container,
 * removes the flag, restarts the same container on the same volumes, and watches the import run
 * to its terminal outcome.
 */

const APP_CONTAINER = process.env['E2E_APP_CONTAINER'] ?? 'music-e2e-app';
const BLOCK_FLAG = join(DATA_DIR, 'bin', 'bridge-blocked');

function docker(args: string): void {
  execSync(`docker ${args}`, { stdio: 'inherit', timeout: 60_000 });
}

describe('restart resilience (durable stores + subscription checkpoint)', () => {
  beforeAll(async () => {
    seedStagedFixture();
    await waitForOk(BASE_URL);
  });

  it('completes the import exactly once across a kill between fulfilment and import', async () => {
    const acquisitionId = await submitAcquisition(MBID);

    // Fulfilment committed (observable over the interface) and the seam handoff durably recorded
    // in the importer's own store — while the blocked bridge guarantees the import cannot finish.
    const status = await pollUntilTerminal(acquisitionId);
    expect(status).toBe('Fulfilled');
    await pollForEvent(IMPORTER_DB, 'ImportRequested');
    expect(countEvents(IMPORTER_DB, 'ImportApplied')).toBe(0);

    // Kill the process mid-import, lift the gate, restart the SAME container on the SAME volumes.
    docker(`stop -t 5 ${APP_CONTAINER}`);
    rmSync(BLOCK_FLAG, { force: true });
    docker(`start ${APP_CONTAINER}`);
    await waitForOk(BASE_URL);

    // No re-submission, no external trigger: the durable reactor resumes from its checkpoint and
    // drives the already-requested import to its terminal outcome — exactly once.
    await pollForEvent(IMPORTER_DB, 'ImportApplied', 120_000);
    expect(countEvents(IMPORTER_DB, 'ImportRequested')).toBe(1);
    expect(countEvents(IMPORTER_DB, 'ImportApplied')).toBe(1);

    // And the interface still tells the same story after the restart.
    expect(await pollUntilTerminal(acquisitionId)).toBe('Fulfilled');
    expect(await reviewQueueEmpty()).toBe(true);
  });
});

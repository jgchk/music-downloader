import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AcquisitionEvent } from '../../src/domain/acquisition/events.js';
import {
  defaultPolicies,
  sampleGroupRequest,
} from '../../src/domain/acquisition/__fixtures__/acquisition-fixtures.js';
import { foldEvents } from '../../src/domain/acquisition/state.js';
import { buildUpcasterRegistry } from '../../src/adapters/sqlite/upcaster.js';

/**
 * Schema-evolution contract: a legacy stored event, folded through the read-side upcaster under the
 * current code, must still replay to the correct state. `EditionCandidate.trackCount` changed from
 * `0-means-unknown` (v1) to optional/absent (v2); the frozen v1 fixture below is exactly the
 * on-disk shape the upcaster promises to fold forever. If this test ever fails, legacy history has
 * become unfoldable — the worst failure an event-sourced store can suffer.
 */

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

const FIXTURE_DIR = new URL('./fixtures/events/', import.meta.url).pathname;

describe('ManualSelectionRequested v1 → v2 upcast (EditionCandidate.trackCount)', () => {
  const fixture = readJson(join(FIXTURE_DIR, 'manual-selection.requested/v1.json')) as {
    event: Record<string, unknown>;
  };

  function upcastFixture(): AcquisitionEvent {
    return buildUpcasterRegistry().upcast('ManualSelectionRequested', 1, {
      ...fixture.event,
    });
  }

  it('drops the legacy trackCount: 0 sentinel to absent, and passes a real count through', () => {
    const event = upcastFixture();
    if (event.type !== 'ManualSelectionRequested') throw new Error('wrong event type');

    const [known, unknown] = event.candidates;
    expect(known.trackCount).toBe(12);
    expect(unknown.trackCount).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(unknown, 'trackCount')).toBe(false);
  });

  it('folds the upcast legacy event to AwaitingManualSelection with the unknown count absent', () => {
    const history: readonly AcquisitionEvent[] = [
      { type: 'AcquisitionRequested', request: sampleGroupRequest, policies: defaultPolicies() },
      upcastFixture(),
    ];

    const state = foldEvents(history);

    expect(state.phase).toBe('AwaitingManualSelection');
    if (state.phase !== 'AwaitingManualSelection') throw new Error('unreachable');
    expect(state.candidates).toEqual([
      {
        releaseMbid: 'boot-1',
        title: 'Live at Budokan',
        date: '1995-05-01',
        country: 'JP',
        format: 'CD',
        trackCount: 12,
      },
      { releaseMbid: 'boot-2', title: 'Promo Sampler' },
    ]);
  });

  it('leaves a current v2 event (already absent for unknown) untouched', () => {
    const v2Event: AcquisitionEvent = {
      type: 'ManualSelectionRequested',
      candidates: [
        { releaseMbid: 'boot-1', title: 'Live at Budokan', trackCount: 12 },
        { releaseMbid: 'boot-2', title: 'Promo Sampler' },
      ],
    };

    const folded = foldEvents([
      { type: 'AcquisitionRequested', request: sampleGroupRequest, policies: defaultPolicies() },
      buildUpcasterRegistry().upcast('ManualSelectionRequested', 2, {
        ...v2Event,
      } as unknown as Record<string, unknown>),
    ]);

    expect(folded.phase).toBe('AwaitingManualSelection');
    if (folded.phase !== 'AwaitingManualSelection') throw new Error('unreachable');
    expect(folded.candidates[1]).toEqual({ releaseMbid: 'boot-2', title: 'Promo Sampler' });
  });
});

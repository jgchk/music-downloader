import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ImportEvent } from '../../src/domain/import/events.js';
import { foldEvents } from '../../src/domain/import/state.js';
import {
  candidate,
  proposed,
  requested,
} from '../../src/domain/import/__fixtures__/import-fixtures.js';
import { UpcasterRegistry } from '../../src/adapters/sqlite/upcaster.js';

/**
 * Schema-evolution contract: `ReviewCause` `match-review.best` was tightened from optional to
 * required. That is only safe because every stored `match-review` event has always carried `best`
 * (the decider reaches match-review solely for a non-empty candidate list; the empty case routes to
 * `no-match`). No upcaster/version bump is needed — the on-disk bytes are already valid under the
 * required type. This test proves the frozen v1 shape still folds through the (pass-through) read
 * path to the correct review state; if it fails, the tightening broke legacy history.
 */

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

const FIXTURE_DIR = new URL('./fixtures/events/', import.meta.url).pathname;

describe('ReviewRequired match-review legacy fold (best now required)', () => {
  const fixture = readJson(join(FIXTURE_DIR, 'review.required/v1.json')) as {
    event: Record<string, unknown>;
  };

  it('folds a legacy stored match-review event to awaiting-review with best present', () => {
    // The importer read path stamps no upcaster (MVP pass-through); the stored bytes are cast as-is.
    const reviewEvent = new UpcasterRegistry().upcast(
      'ReviewRequired',
      1,
      fixture.event,
    ) as ImportEvent;

    const history: readonly ImportEvent[] = [
      requested({ hints: { mbReleaseId: 'mb-release-1' } }),
      proposed([candidate()]),
      reviewEvent,
    ];

    const state = foldEvents(history);

    expect(state.phase).toBe('awaiting-review');
    if (state.phase !== 'awaiting-review') throw new Error('unreachable');
    expect(state.cause.kind).toBe('match-review');
    if (state.cause.kind !== 'match-review') throw new Error('unreachable');
    expect(state.cause.best).toEqual({ dataSource: 'MusicBrainz', albumId: 'album-1' });
  });
});

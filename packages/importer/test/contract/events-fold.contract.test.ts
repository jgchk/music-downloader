import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ImportEvent } from '../../src/domain/import/events.js';
import { foldEvents } from '../../src/domain/import/state.js';
import {
  MATCH_REVIEW,
  candidate,
  proposed,
  requested,
} from '../../src/domain/import/__fixtures__/import-fixtures.js';
import { buildUpcasterRegistry } from '../../src/adapters/sqlite/upcaster.js';

/**
 * Schema-evolution contracts, replayed through the PRODUCTION upcaster registry — the same
 * `buildUpcasterRegistry()` composition wires into the store — so this tier fails if the
 * registry ever stops lifting a frozen on-disk shape (an empty registry here would prove
 * nothing: it would pass while production data rotted).
 *
 * Case 1 (`review.required/v1.json`): `ReviewCause` `match-review.best` was tightened from
 * optional to required. That is only safe because every stored `match-review` event has always
 * carried `best` (the decider reaches match-review solely for a non-empty candidate list; the
 * empty case routes to `no-match`). No upcaster is registered for it — the registry must pass
 * the frozen v1 bytes through as already-current, and they must fold to the correct state.
 *
 * Case 2 (`review.resolved/v1.json`): the resolution verb rename (`reject-and-retry-download`
 * → `reject-unusable-delivery`). The frozen v1 bytes carry the old token; the registry's
 * v1→v2 step must rewrite it before the pure domain ever sees it.
 */

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

const FIXTURE_DIR = new URL('./fixtures/events/', import.meta.url).pathname;

function upcastFixture(type: string, relative: string): ImportEvent {
  const fixture = readJson(join(FIXTURE_DIR, relative)) as { event: Record<string, unknown> };
  return buildUpcasterRegistry().upcast(type, 1, fixture.event)._unsafeUnwrap();
}

describe('ReviewRequired match-review legacy fold (best now required)', () => {
  it('folds a legacy stored match-review event to awaiting-review with best present', () => {
    const reviewEvent = upcastFixture('ReviewRequired', 'review.required/v1.json');

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

describe('ReviewResolved v1 → v2 upcast (resolution verb rename)', () => {
  it('lifts the frozen pre-rename verb through the production registry before the fold', () => {
    const resolvedEvent = upcastFixture('ReviewResolved', 'review.resolved/v1.json');

    if (resolvedEvent.type !== 'ReviewResolved') throw new Error('wrong event type');
    expect(resolvedEvent.resolution).toEqual({
      kind: 'reject-unusable-delivery',
      reasons: ['corrupt rip', 'wrong pressing'],
    });
  });

  it('folds the upcast legacy resolution to a pending rejection in the importer language', () => {
    const history: readonly ImportEvent[] = [
      requested(),
      proposed([candidate()]),
      MATCH_REVIEW,
      upcastFixture('ReviewResolved', 'review.resolved/v1.json'),
    ];

    const state = foldEvents(history);

    expect(state.phase).toBe('awaiting-review');
    if (state.phase !== 'awaiting-review') throw new Error('unreachable');
    expect(state.settled).toEqual({
      kind: 'reject-unusable-delivery',
      reasons: ['corrupt rip', 'wrong pressing'],
    });
  });
});

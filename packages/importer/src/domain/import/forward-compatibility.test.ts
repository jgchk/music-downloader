import { describe, expect, it } from 'vitest';
import { foldEvents, initialState } from './state.js';
import { react } from './react.js';
import type { ImportEvent } from './events.js';

/**
 * Forward compatibility across the storage seam. A log written by a newer build can carry an event
 * type this build has never heard of; the seam passes that token through untranslated rather than
 * losing the row (see `adapters/sqlite/event-tokens.ts`). These tests are what makes that
 * tolerance safe instead of a deferred crash: the decider ignores the unknown tag, so replay stays
 * total. Without them, `evolve` falls off its exhaustive switch and returns `undefined`, and the
 * NEXT event in the stream dereferences it.
 */

const FROM_A_NEWER_BUILD = { type: 'SomethingThisBuildHasNeverHeardOf' } as unknown as ImportEvent;

describe('an event type this build does not know', () => {
  it('folds to the state it started from rather than undefined', () => {
    expect(foldEvents([FROM_A_NEWER_BUILD])).toEqual(initialState);
  });

  it('does not break the fold of the events around it', () => {
    const history = [FROM_A_NEWER_BUILD] as readonly ImportEvent[];
    expect(() => foldEvents([...history, ...history])).not.toThrow();
  });

  it('provokes no effect', () => {
    expect(react(FROM_A_NEWER_BUILD, initialState)).toEqual([]);
  });
});

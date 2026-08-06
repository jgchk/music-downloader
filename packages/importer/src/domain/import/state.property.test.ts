import { test } from '@fast-check/vitest';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { assertProperty, propertyRun } from '../../__fixtures__/property.js';
import { toAcquisitionId } from '../shared/acquisition-id.js';
import type { ImportEvent } from './events.js';
import { react } from './react.js';
import type { Effect } from './react.js';
import { evolve, foldEvents } from './state.js';
import type { ImportPhase, ImportState } from './state.js';
import { arbEvent } from './__fixtures__/arbitraries.js';
import { arbAnyHistory, arbReachableStates } from './__fixtures__/decider-runner.js';

/**
 * Property suite for the import fold and reactor contract (decider-properties D1, task 3.1). The
 * twin of the acquisition suite: `evolve` is the replay path and must be total over every event a
 * stream can contain, and the reactor's prefix-fold dispatch is only sound if the fold is
 * deterministic and prefix-consistent.
 */

/**
 * Exhaustive over the phase union rather than a hand-written `Set`: a new phase is a compile error
 * here, instead of silently making this property assert less than it claims.
 */
const KNOWN_PHASE_TABLE: Record<ImportPhase, true> = {
  empty: true,
  requested: true,
  proposing: true,
  'awaiting-review': true,
  applying: true,
  applied: true,
  rejected: true,
};
const KNOWN_PHASES: readonly ImportPhase[] = Object.keys(KNOWN_PHASE_TABLE) as ImportPhase[];

/** Exhaustive over the effect union, for the same reason as {@link KNOWN_PHASE_TABLE}. */
const KNOWN_EFFECT_TABLE: Record<Effect['type'], true> = {
  Propose: true,
  Apply: true,
  DeleteIntake: true,
};
const KNOWN_EFFECTS: readonly Effect['type'][] = Object.keys(
  KNOWN_EFFECT_TABLE,
) as Effect['type'][];

/** Event soup, decider-minted history, and decider-minted history with illegal events spliced in. */
const arbHistory: fc.Arbitrary<readonly ImportEvent[]> = arbAnyHistory;

/**
 * The value-level fold properties use `@fast-check/vitest`'s `test.prop`, which registers the test
 * and the arbitraries in one breath — the most readable form when a property is exactly "for all
 * inputs, this holds". The suites elsewhere use `assertProperty(fc.property(...))` inside a plain
 * `it`, because those properties also accumulate reached-counters and assert them after the sweep,
 * which `test.prop` has no place to put. Both run under the same pinned {@link propertyRun}.
 */
describe('evolve is total over every event a stream can contain', () => {
  test.prop([arbReachableStates, arbEvent], propertyRun)(
    'folds any event onto any reachable state, yielding a known phase',
    (states, event) => {
      for (const state of states) {
        expect(KNOWN_PHASES).toContain(evolve(state, event).phase);
      }
    },
  );

  test.prop([arbReachableStates, arbEvent], propertyRun)(
    'leaves the state it was given untouched — the fold is pure, not in-place',
    (states, event) => {
      for (const state of states) {
        const before = structuredClone(state);

        evolve(state, event);

        expect(state).toEqual(before);
      }
    },
  );

  test.prop([arbReachableStates, arbEvent], propertyRun)(
    'answers identically however many times it is asked',
    (states, event) => {
      for (const state of states) {
        expect(evolve(state, event)).toEqual(evolve(state, event));
      }
    },
  );

  it('folds a release verdict as the record-only fact it is', () => {
    // `ReleaseVerdictRecorded` exists for the outbound publisher alone: it drives no effect and
    // changes no import state, on any state whatsoever.
    assertProperty(
      fc.property(arbReachableStates, (states) => {
        const verdict: ImportEvent = {
          type: 'ReleaseVerdictRecorded',
          acquisitionId: toAcquisitionId('acq-1'),
          candidate: { username: 'peer-a', path: 'peer-a/Repeater [FLAC]' },
          reasons: ['transcode'],
        };

        for (const state of states) {
          expect(evolve(state, verdict)).toBe(state); // the same reference: nothing changed
          expect(react(verdict, state)).toEqual([]);
        }
      }),
    );
  });
});

describe('the fold is deterministic', () => {
  it('replays a history to the same state every time', () => {
    assertProperty(
      fc.property(arbHistory, (history) => {
        expect(foldEvents(history)).toEqual(foldEvents(history));
      }),
    );
  });
});

describe('the fold is prefix-consistent — the reactor’s dispatch contract', () => {
  it('reaches the same state whether folded whole or one event past its prefix', () => {
    assertProperty(
      fc.property(arbHistory, (history) => {
        for (const [index, event] of history.entries()) {
          const prefix = foldEvents(history.slice(0, index));

          expect(evolve(prefix, event)).toEqual(foldEvents(history.slice(0, index + 1)));
        }
      }),
    );
  });

  it('hands react the post-event state: an apply effect targets the directory then in play', () => {
    // The reactor slices the stream before reacting, so `react` reads the state *as of* the event
    // it is given — which is what lets it narrow on phase and reach for the directory and mode the
    // fold just settled. An apply is the effect with the most to get wrong, so it is the one pinned.
    // Per ARM, not per effect type: `Apply` has two lawful shapes and a counter spanning both
    // would go green having only ever seen one of them.
    let intakeAppliesChecked = 0;
    let retryAppliesChecked = 0;
    let deletionsChecked = 0;
    let proposalsChecked = 0;

    /** Judge one effect against the state as of the event that produced it. */
    function expectEffectMatchesState(effect: Effect, event: ImportEvent, asOf: ImportState): void {
      switch (effect.type) {
        case 'Apply': {
          // Two lawful shapes: the apply beets was just told to run, over the intake directory
          // (`applying`), and the in-place re-import of an already-moved library location
          // (`applied` with its remediation retrying). Nothing else may produce an apply.
          if (asOf.phase === 'applying') {
            intakeAppliesChecked += 1;
            expect(effect.directory).toBe(asOf.directory);
            expect(effect.mode).toEqual(asOf.mode);
          } else if (asOf.phase === 'applied') {
            retryAppliesChecked += 1;
            expect(effect.directory).toBe(asOf.location);
            expect(effect.mode).toEqual(asOf.mode);
          } else {
            expect.unreachable(`an apply effect from phase ${asOf.phase}`);
          }
          return;
        }
        case 'DeleteIntake': {
          deletionsChecked += 1;
          expect(asOf.phase).toBe('awaiting-review');
          expect(effect.directory).toBe('directory' in asOf ? asOf.directory : undefined);
          return;
        }
        case 'Propose': {
          // The most-fired effect, and previously asserted only by membership in the known-effect
          // set. It carries the intake directory, and a proposal pointed at the wrong directory
          // would re-read someone else's files.
          proposalsChecked += 1;
          expect(effect.directory).toBe(
            event.type === 'ImportRequested'
              ? event.directory
              : 'directory' in asOf
                ? asOf.directory
                : undefined,
          );
          return;
        }
      }
    }

    assertProperty(
      fc.property(arbHistory, (history) => {
        for (const [index, event] of history.entries()) {
          const asOf = foldEvents(history.slice(0, index + 1));

          for (const effect of react(event, asOf)) {
            expectEffectMatchesState(effect, event, asOf);
          }
        }
      }),
    );

    expect(intakeAppliesChecked).toBeGreaterThan(0);
    expect(retryAppliesChecked).toBeGreaterThan(0);
    expect(deletionsChecked).toBeGreaterThan(0);
    expect(proposalsChecked).toBeGreaterThan(0);
  });

  it('only ever describes effects the interpreter knows how to run', () => {
    assertProperty(
      fc.property(arbHistory, (history) => {
        const head = foldEvents(history);

        for (const [index, event] of history.entries()) {
          const asOf = foldEvents(history.slice(0, index + 1));

          // Both dispatch paths: the reactor's as-of slice, and a redrive re-reacting an old event
          // against the head state. Neither may reach an effect the interpreter cannot run.
          for (const effect of [...react(event, asOf), ...react(event, head)]) {
            expect(KNOWN_EFFECTS).toContain(effect.type);
          }
        }
      }),
    );
  });
});

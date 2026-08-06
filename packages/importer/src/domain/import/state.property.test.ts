import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { assertProperty } from '../../__fixtures__/property.js';
import { toAcquisitionId } from '../shared/acquisition-id.js';
import type { ImportEvent } from './events.js';
import { react } from './react.js';
import type { Effect } from './react.js';
import { evolve, foldEvents, initialState } from './state.js';
import type { ImportPhase, ImportState } from './state.js';
import { arbEvent } from './__fixtures__/arbitraries.js';
import { arbAnyHistory, arbReachableStates } from './__fixtures__/decider-runner.js';

/**
 * Property suite for the import fold and reactor contract (decider-properties D1, task 3.1). The
 * twin of the acquisition suite: `evolve` is the replay path and must be total over every event a
 * stream can contain, and the reactor's prefix-fold dispatch is only sound if the fold is
 * deterministic and prefix-consistent.
 */

const KNOWN_PHASES: ReadonlySet<ImportPhase> = new Set<ImportPhase>([
  'empty',
  'requested',
  'proposing',
  'awaiting-review',
  'applying',
  'applied',
  'rejected',
]);

const KNOWN_EFFECTS: ReadonlySet<Effect['type']> = new Set<Effect['type']>([
  'Propose',
  'Apply',
  'DeleteIntake',
]);

/** Event soup, decider-minted history, and decider-minted history with illegal events spliced in. */
const arbHistory: fc.Arbitrary<readonly ImportEvent[]> = arbAnyHistory;

describe('evolve is total over every event a stream can contain', () => {
  it('folds any event onto any reachable state, yielding a known phase', () => {
    assertProperty(
      fc.property(arbReachableStates, arbEvent, (states, event) => {
        for (const state of states) {
          expect(KNOWN_PHASES.has(evolve(state, event).phase)).toBe(true);
        }
      }),
    );
  });

  it('leaves the state it was given untouched — the fold is pure, not in-place', () => {
    assertProperty(
      fc.property(arbReachableStates, arbEvent, (states, event) => {
        for (const state of states) {
          const before = structuredClone(state);

          evolve(state, event);

          expect(state).toEqual(before);
        }
      }),
    );
  });

  it('answers identically however many times it is asked', () => {
    assertProperty(
      fc.property(arbReachableStates, arbEvent, (states, event) => {
        for (const state of states) {
          expect(evolve(state, event)).toEqual(evolve(state, event));
        }
      }),
    );
  });

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

  it('is exactly the left fold of evolve over the history', () => {
    assertProperty(
      fc.property(arbHistory, (history) => {
        let manual: ImportState = initialState;
        for (const event of history) manual = evolve(manual, event);

        expect(foldEvents(history)).toEqual(manual);
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
    let appliesChecked = 0;
    let proposalsChecked = 0;

    assertProperty(
      fc.property(arbHistory, (history) => {
        for (const [index, event] of history.entries()) {
          const asOf = foldEvents(history.slice(0, index + 1));

          for (const effect of react(event, asOf)) {
            if (effect.type === 'Apply') {
              appliesChecked += 1;
              // Two lawful shapes: the apply beets was just told to run, over the intake directory
              // (`applying`), and the in-place re-import of an already-moved library location
              // (`applied` with its remediation retrying). Nothing else may produce an apply.
              if (asOf.phase === 'applying') {
                expect(effect.directory).toBe(asOf.directory);
                expect(effect.mode).toEqual(asOf.mode);
              } else if (asOf.phase === 'applied') {
                expect(effect.directory).toBe(asOf.location);
                expect(effect.mode).toEqual(asOf.mode);
              } else {
                expect.unreachable(`an apply effect from phase ${asOf.phase}`);
              }
            } else if (effect.type === 'DeleteIntake') {
              proposalsChecked += 1;
              expect(asOf.phase).toBe('awaiting-review');
              expect(effect.directory).toBe('directory' in asOf ? asOf.directory : undefined);
            }
          }
        }
      }),
    );

    expect(appliesChecked).toBeGreaterThan(0);
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
            expect(KNOWN_EFFECTS.has(effect.type)).toBe(true);
          }
        }
      }),
    );
  });
});

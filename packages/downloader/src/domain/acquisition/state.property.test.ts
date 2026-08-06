import { test } from '@fast-check/vitest';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { assertProperty, propertyRun } from '../../__fixtures__/property.js';
import type { AcquisitionEvent } from './events.js';
import { react } from './react.js';
import { evolve, foldEvents, initialState } from './state.js';
import type { AcquisitionPhase, AcquisitionState } from './state.js';
import { arbEvent } from './__fixtures__/arbitraries.js';
import {
  ABSORBING_PHASES,
  arbAnyHistory,
  arbDecidedHistory,
  arbReachableStates,
} from './__fixtures__/decider-runner.js';
import type { Effect } from './react.js';

/**
 * Property suite for the fold and the reactor contract (decider-properties D1). `evolve` is the
 * replay path: it must be total over every event a stream can contain — including the
 * out-of-protocol pairings only a corrupt or externally-edited history produces — and the reactor's
 * prefix-fold dispatch is only sound if the fold is deterministic and prefix-consistent.
 */

/**
 * Exhaustive over the phase union rather than a hand-written `Set`: a new phase is a compile error
 * here, instead of silently making this property assert less than it claims.
 */
const KNOWN_PHASE_TABLE: Record<AcquisitionPhase, true> = {
  Empty: true,
  Pending: true,
  AwaitingManualSelection: true,
  Searching: true,
  Selecting: true,
  Downloading: true,
  Validating: true,
  Importing: true,
  Fulfilled: true,
  Exhausted: true,
  Cancelled: true,
  MetadataFailed: true,
  Conflicted: true,
};
const KNOWN_PHASES: readonly AcquisitionPhase[] = Object.keys(
  KNOWN_PHASE_TABLE,
) as AcquisitionPhase[];

/** Exhaustive over the effect union, for the same reason as {@link KNOWN_PHASE_TABLE}. */
const KNOWN_EFFECT_TABLE: Record<Effect['type'], true> = {
  ResolveMetadata: true,
  Search: true,
  Download: true,
  Validate: true,
  Import: true,
  Cleanup: true,
  AbortDownload: true,
};
const KNOWN_EFFECTS: readonly Effect['type'][] = Object.keys(
  KNOWN_EFFECT_TABLE,
) as Effect['type'][];

/** Event soup, decider-minted history, and decider-minted history with illegal events spliced in. */
const arbHistory: fc.Arbitrary<readonly AcquisitionEvent[]> = arbAnyHistory;

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

  it('never lets any event — lawful or not — reopen an absorbed acquisition', () => {
    let absorptionsObserved = 0;

    assertProperty(
      fc.property(arbHistory, (history) => {
        // Absorption is a property of the fold itself, not just of the decisions in front of it: a
        // corrupt or hand-edited stream must not be able to walk an exhausted, cancelled, failed,
        // or conflicted acquisition back into an active phase.
        let settled: AcquisitionPhase | undefined;
        let state: AcquisitionState = initialState;
        for (const event of history) {
          state = evolve(state, event);
          if (settled !== undefined) {
            absorptionsObserved += 1;
            expect(state.phase).toBe(settled);
          }
          if (ABSORBING_PHASES.has(state.phase)) settled = state.phase;
        }
      }),
    );

    expect(absorptionsObserved).toBeGreaterThan(0);
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

  it('hands react the post-event state: a transfer effect names the candidate then in flight', () => {
    // Scoped to WELL-FORMED histories on purpose. On a corrupted stream the guarantee genuinely
    // does not hold, and should not be asserted: a spliced `CandidateSelected` landing on an
    // already-`Downloading` state is ignored by the tolerant fold, so `react` reports the event's
    // candidate while the folded state still holds the previous one. That divergence IS the
    // tolerant-fold contract; only a history the decider minted has a candidate to agree about.
    //
    // A property that never reaches its assertion is worse than no property, and this one only
    // bites where a transfer effect is actually produced. The counters make that visible: if the
    // corpus stops producing downloads or aborts, this test fails instead of quietly passing.
    let downloadsChecked = 0;
    let abortsChecked = 0;

    assertProperty(
      fc.property(arbDecidedHistory, (history) => {
        // The reactor slices the stream before reacting, so `react` reads the state *as of* the
        // event it is given. That is what lets it narrow on phase and reach for the candidate in
        // flight — and it is exactly what this property pins: an effect that names a candidate
        // always names the one the as-of state holds, never a neighbour from the batch.
        for (const [index, event] of history.entries()) {
          const asOf = foldEvents(history.slice(0, index + 1));

          for (const effect of react(event, asOf)) {
            if (effect.type === 'Download') {
              downloadsChecked += 1;
              expect(asOf.phase).toBe('Downloading');
              expect('current' in asOf ? asOf.current.identity : undefined).toEqual(
                effect.candidate.identity,
              );
            } else if (effect.type === 'AbortDownload') {
              abortsChecked += 1;
              expect(asOf.phase).toBe('Cancelled');
              expect(
                asOf.phase === 'Cancelled' && asOf.staging.kind === 'in-flight'
                  ? asOf.staging.pending.identity
                  : undefined,
              ).toEqual(effect.candidate.identity);
            }
          }
        }
      }),
    );

    expect(downloadsChecked).toBeGreaterThan(0);
    expect(abortsChecked).toBeGreaterThan(0);
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

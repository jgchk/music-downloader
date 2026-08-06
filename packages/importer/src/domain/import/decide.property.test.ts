import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { assertProperty } from '../../__fixtures__/property.js';
import { candidateReferenceKey } from './events.js';
import { decide } from './decide.js';
import type { ImportCommandType } from './commands.js';
import type { ImportEventType, ResolutionKind } from './events.js';
import { initialState } from './state.js';
import type { ImportPhase } from './state.js';
import {
  arbBlindCommandStep,
  arbCommandSequence,
  arbSource,
  blindStepArbitraryByCommandType,
  eventArbitraryByType,
  resolutionArbitraryByKind,
} from './__fixtures__/arbitraries.js';
import { driveCommands, watermarkOf } from './__fixtures__/decider-runner.js';
import type { DriveResult } from './__fixtures__/decider-runner.js';

/**
 * Property suite for the import decider (decider-properties D1, task 3.1). Same registers and same
 * assertions as the acquisition suite where the two aggregates agree; the divergences are the ones
 * this aggregate genuinely has, and each is noted where it appears rather than smoothed away.
 */

const ALL_PHASES: readonly ImportPhase[] = [
  'empty',
  'requested',
  'proposing',
  'awaiting-review',
  'applying',
  'applied',
  'rejected',
];

/** Sort names so the coverage assertion compares sets, not incidental insertion order. */
const byName = (a: string, b: string): number => a.localeCompare(b);

describe('the generators cover the decider’s whole command, event, and verb surface', () => {
  it('generates every event variant, and only under its own key', () => {
    for (const [type, arbitrary] of Object.entries(eventArbitraryByType)) {
      const samples = fc.sample(arbitrary, { numRuns: 10, seed: 1 });

      expect(samples).not.toHaveLength(0);
      expect(samples.map((event) => event.type)).toEqual(
        Array.from({ length: samples.length }, () => type as ImportEventType),
      );
    }
  });

  it('generates every command variant, and only under its own key', () => {
    for (const [type, arbitrary] of Object.entries(blindStepArbitraryByCommandType)) {
      const samples = fc.sample(arbitrary, { numRuns: 10, seed: 1 });

      expect(samples).not.toHaveLength(0);
      expect(samples.map((step) => step(initialState).type)).toEqual(
        Array.from({ length: samples.length }, () => type as ImportCommandType),
      );
    }
  });

  it('generates every resolution verb, and only under its own key', () => {
    for (const [kind, arbitrary] of Object.entries(resolutionArbitraryByKind)) {
      const samples = fc.sample(arbitrary, { numRuns: 10, seed: 1 });

      expect(samples).not.toHaveLength(0);
      expect(samples.map((resolution) => resolution.kind)).toEqual(
        Array.from({ length: samples.length }, () => kind as ResolutionKind),
      );
    }
  });
});

describe('decide is total: every reachable state answers every command with a value', () => {
  it('returns a Result — never throws — for any command on any reachable state', () => {
    assertProperty(
      fc.property(arbCommandSequence, arbBlindCommandStep, (plan, intruder) => {
        for (const state of driveCommands(plan).states) {
          const decision = decide(intruder(state), state);

          expect(decision.isOk() || decision.isErr()).toBe(true);
        }
      }),
    );
  });

  it('never lets an errored decision emit events (an error is a refusal, not a partial append)', () => {
    assertProperty(
      fc.property(arbCommandSequence, (plan) => {
        for (const decision of driveCommands(plan).decisions) {
          if (decision.error !== undefined) expect(decision.emitted).toEqual([]);
        }
      }),
    );
  });
});

describe('no reachable state violates an import invariant', () => {
  function expectInvariants(run: DriveResult): void {
    for (const decision of run.decisions) {
      for (const event of decision.emitted) {
        if (event.type === 'AutoApplySelected') {
          // Auto-apply is exactly the strong, unduplicated match — never a judgement call.
          const state = decision.before;
          const threshold = 'policy' in state ? state.policy.autoApplyThreshold : Infinity;
          expect(event.distance).toBeLessThanOrEqual(threshold);
        }
        if (event.type === 'ReviewRequired' && event.cause.kind === 'match-review') {
          // `match-review` is only reached for a non-empty candidate list, so `best` is always
          // populated — the empty case routes to `no-match` first.
          expect(event.cause.best).toBeDefined();
          expect(event.cause.hinted).toBe(event.cause.hintedReleaseId !== undefined);
        }
      }
    }

    for (const state of run.states) {
      if (state.phase === 'awaiting-review' && state.cause.kind === 'duplicate-review') {
        // A duplicate review with nothing to compare would be a dead end.
        expect(state.cause.incumbents.length).toBeGreaterThan(0);
      }
      if (state.phase === 'applied' && state.remediation !== undefined) {
        expect(state.remediation.failures.length).toBeGreaterThan(0);
      }
    }
  }

  it('holds every invariant across generated command sequences', () => {
    assertProperty(
      fc.property(arbCommandSequence, (plan) => {
        expectInvariants(driveCommands(plan));
      }),
    );
  });

  it('re-derives beets’ ordering: auto-apply names the lowest-distance candidate', () => {
    // `decide` never trusts the order it is handed, so a shuffled proposal must select the same
    // candidate as a sorted one.
    let selections = 0;

    assertProperty(
      fc.property(arbCommandSequence, (plan) => {
        const run = driveCommands(plan);
        for (const decision of run.decisions) {
          if (decision.command.type !== 'RecordProposal') continue;
          const offered = decision.command.candidates;
          const selected = decision.emitted.filter((event) => event.type === 'AutoApplySelected');
          for (const event of selected) {
            selections += 1;
            const best = Math.min(...offered.map((candidate) => candidate.distance));

            expect(event.distance).toBe(best);
            expect(
              offered.some(
                (candidate) =>
                  candidateReferenceKey(candidate.ref) === candidateReferenceKey(event.ref) &&
                  candidate.distance === best,
              ),
            ).toBe(true);
          }
        }
      }),
    );

    expect(selections).toBeGreaterThan(0);
  });

  it('never lets the seam watermark run backwards', () => {
    // The watermark is the stream's convergence guarantee: folded as a max across cycles so a
    // manual resubmission (which carries no source) cannot erase it and reopen the stream to
    // redeliveries of deliveries already imported.
    assertProperty(
      fc.property(arbCommandSequence, (plan) => {
        const run = driveCommands(plan);
        for (const [index, state] of run.states.entries()) {
          if (index === 0) continue;
          const previous = watermarkOf(run.states[index - 1]!);
          if (previous === undefined) continue;

          expect(watermarkOf(state) ?? -Infinity).toBeGreaterThanOrEqual(previous);
        }
      }),
    );
  });
});

describe('a delivery is never silently dropped, and never duplicated', () => {
  it('refuses a NEW delivery onto a live cycle rather than swallowing it', () => {
    // Converging would acknowledge — and permanently lose — the delivery, so the seam consumer
    // must be told to hold. A stale redelivery converges instead; the watermark tells them apart.
    let refusals = 0;
    let convergences = 0;

    assertProperty(
      fc.property(arbCommandSequence, arbSource, (plan, source) => {
        for (const state of driveCommands(plan).states) {
          const isLive =
            state.phase !== 'empty' && state.phase !== 'applied' && state.phase !== 'rejected';
          if (!isLive) continue;
          // The watermark rule, stated as the seam consumer relies on it: a sourced delivery is
          // NEW when it sits past everything this stream ever recorded (or the stream has no
          // watermark at all); anything else — including an unsourced manual submission — is not.
          const watermark = watermarkOf(state);
          const incoming = source.feedPosition;
          const isNew = incoming !== undefined && (watermark === undefined || incoming > watermark);

          const decision = decide(
            { type: 'SubmitImport', directory: state.directory, policy: state.policy, source },
            state,
          );

          if (isNew) {
            refusals += 1;
            expect(decision._unsafeUnwrapErr()).toEqual({ kind: 'CycleInFlight' });
          } else {
            convergences += 1;
            expect(decision._unsafeUnwrap()).toEqual([]);
          }
        }
      }),
    );

    expect(refusals).toBeGreaterThan(0);
    expect(convergences).toBeGreaterThan(0);
  });

  it('converges a redelivery at or before the watermark onto a settled cycle', () => {
    let convergences = 0;

    assertProperty(
      fc.property(arbCommandSequence, arbSource, (plan, source) => {
        for (const state of driveCommands(plan).states) {
          if (state.phase !== 'applied' && state.phase !== 'rejected') continue;
          const watermark = watermarkOf(state);
          if (watermark === undefined || source.feedPosition === undefined) continue;
          if (source.feedPosition > watermark) continue;

          const decision = decide(
            { type: 'SubmitImport', directory: state.directory, policy: state.policy, source },
            state,
          );

          convergences += 1;
          expect(decision._unsafeUnwrap()).toEqual([]);
        }
      }),
    );

    expect(convergences).toBeGreaterThan(0);
  });
});

describe('a settled review still owes its intake deletion', () => {
  it('answers a further resolution with silence but still deletes when told the intake is gone', () => {
    let settledReviews = 0;

    assertProperty(
      fc.property(arbCommandSequence, arbBlindCommandStep, (plan, intruder) => {
        for (const state of driveCommands(plan).states) {
          if (state.phase !== 'awaiting-review' || state.settled === undefined) continue;
          settledReviews += 1;

          const command = intruder(state);
          if (command.type === 'ResolveReview') {
            // The rejection is recorded; a redelivered resolution changes nothing.
            expect(decide(command, state)._unsafeUnwrap()).toEqual([]);
          }
          // The deletion is still owed, and recording it always terminates the import.
          const deleted = decide({ type: 'RecordIntakeDeleted' }, state)._unsafeUnwrap();
          expect(deleted.map((event) => event.type)).toEqual(['ImportRejected']);
        }
      }),
    );

    expect(settledReviews).toBeGreaterThan(0);
  });
});

describe('the sweep is not vacuous: the generated plans reach the whole lifecycle', () => {
  it('visits every phase and exercises every command across the pinned corpus', () => {
    const phasesSeen = new Set<ImportPhase>();
    const commandsSeen = new Set<ImportCommandType>();

    assertProperty(
      fc.property(arbCommandSequence, (plan) => {
        const run = driveCommands(plan);
        for (const state of run.states) phasesSeen.add(state.phase);
        for (const decision of run.decisions) commandsSeen.add(decision.command.type);
      }),
    );

    expect([...phasesSeen].toSorted(byName)).toEqual([...ALL_PHASES].toSorted(byName));
    expect([...commandsSeen].toSorted(byName)).toEqual(
      Object.keys(blindStepArbitraryByCommandType).toSorted(byName),
    );
  });
});

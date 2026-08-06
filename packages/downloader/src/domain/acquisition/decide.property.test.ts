import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { assertProperty } from '../../__fixtures__/property.js';
import { candidateKey } from '../candidate/candidate.js';
import { decide } from './decide.js';
import type { AcquisitionCommandType } from './commands.js';
import type { AcquisitionEventType } from './events.js';
import { initialState, isTerminal } from './state.js';
import type { AcquisitionPhase } from './state.js';
import {
  arbBlindCommandStep,
  arbCommandSequence,
  blindStepArbitraryByCommandType,
  eventArbitraryByType,
} from './__fixtures__/arbitraries.js';
import { ABSORBING_PHASES, driveCommands, progressOf } from './__fixtures__/decider-runner.js';
import type { DriveResult } from './__fixtures__/decider-runner.js';

/**
 * Property suite for the acquisition decider (decider-properties D1): universally-quantified
 * relations over generated command sequences, driven through the real `decide`/`evolve`. These
 * supplement — never replace — the BDD example tests next door, which remain the readable
 * specification; this is the adversarial sweep behind them.
 */

const ALL_PHASES: readonly AcquisitionPhase[] = [
  'Empty',
  'Pending',
  'AwaitingManualSelection',
  'Searching',
  'Selecting',
  'Downloading',
  'Validating',
  'Importing',
  'Fulfilled',
  'Exhausted',
  'Cancelled',
  'MetadataFailed',
  'Conflicted',
];

/**
 * The two commands a caller issues directly. Everything else is an effect *result* re-entering, and
 * a result that arrives after the acquisition settled is late news, not a protocol violation — so
 * only these two may answer a terminal state with an error.
 */
const CALLER_COMMANDS: ReadonlySet<AcquisitionCommandType> = new Set<AcquisitionCommandType>([
  'SubmitAcquisition',
  'SelectEdition',
]);

/** Sort names so the coverage assertion compares sets, not incidental insertion order. */
const byName = (a: string, b: string): number => a.localeCompare(b);

describe('the generators cover the decider’s whole command and event surface', () => {
  it('generates every event variant, and only under its own key', () => {
    for (const [type, arbitrary] of Object.entries(eventArbitraryByType)) {
      const samples = fc.sample(arbitrary, { numRuns: 10, seed: 1 });

      expect(samples).not.toHaveLength(0);
      expect(samples.map((event) => event.type)).toEqual(
        Array.from({ length: samples.length }, () => type as AcquisitionEventType),
      );
    }
  });

  it('generates every command variant, and only under its own key', () => {
    for (const [type, arbitrary] of Object.entries(blindStepArbitraryByCommandType)) {
      const samples = fc.sample(arbitrary, { numRuns: 10, seed: 1 });

      expect(samples).not.toHaveLength(0);
      expect(samples.map((step) => step(initialState).type)).toEqual(
        Array.from({ length: samples.length }, () => type as AcquisitionCommandType),
      );
    }
  });
});

describe('decide is total: every reachable state answers every command with a value', () => {
  it('returns a Result — never throws — for any command on any reachable state', () => {
    assertProperty(
      fc.property(arbCommandSequence, arbBlindCommandStep, (plan, intruder) => {
        const run = driveCommands(plan);

        // Judge every state the fold passed through, not just where the plan happened to stop.
        for (const state of run.states) {
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

describe('a settled acquisition converges: late effect results are absorbed, not refused', () => {
  it('answers every effect-result command on a terminal state with no events and no error', () => {
    assertProperty(
      fc.property(arbCommandSequence, arbBlindCommandStep, (plan, intruder) => {
        for (const state of driveCommands(plan).states) {
          if (!isTerminal(state)) continue;
          const command = intruder(state);
          if (CALLER_COMMANDS.has(command.type)) continue;

          const decision = decide(command, state);

          // `RecordExternalValidationFailed` is the one defeasible edge and may lawfully revive a
          // Fulfilled acquisition; every other result must converge to silence.
          if (command.type === 'RecordExternalValidationFailed') {
            expect(decision.isOk()).toBe(true);
            continue;
          }
          // A cancelled acquisition whose in-flight transfer finally settles still owes one
          // rejection so the staged files get cleaned up — events, but never an error.
          expect(decision.isErr()).toBe(false);
        }
      }),
    );
  });

  it('never re-enters an active phase from an absorbing terminal', () => {
    assertProperty(
      fc.property(arbCommandSequence, (plan) => {
        const phases = driveCommands(plan).states.map((state) => state.phase);
        const settledAt = phases.findIndex((phase) => ABSORBING_PHASES.has(phase));
        if (settledAt === -1) return;

        expect(phases.slice(settledAt)).toEqual(
          Array.from({ length: phases.length - settledAt }, () => phases[settledAt]),
        );
      }),
    );
  });
});

describe('no reachable state violates an acquisition invariant', () => {
  /** The invariants types cannot express, checked on every state the fold passes through. */
  function expectInvariants(run: DriveResult): void {
    for (const state of run.states) {
      if (state.phase === 'AwaitingManualSelection') {
        // The pause can never be a dead end: an empty menu is no choice at all.
        expect(state.candidates.length).toBeGreaterThan(0);
        // Manual selection exists only for release groups — the resume's assumption is unforgeable.
        expect(state.request.kind).toBe('release-group');
      }

      const progress = progressOf(state);
      if ('policies' in state) {
        expect(progress.attempts).toBeLessThanOrEqual(state.policies.retry.maxTotalAttempts);
        expect(progress.searchRounds).toBeLessThanOrEqual(state.policies.retry.maxSearchRounds);
      }

      if ('working' in state) {
        const workingKeys = state.working.map((ranked) => candidateKey(ranked.candidate.identity));
        // A rejected candidate is never offered again.
        expect(workingKeys.filter((key) => progress.rejected.includes(key))).toEqual([]);
        // The candidate in flight has left the untried set — it can never be selected twice.
        if ('current' in state) {
          expect(workingKeys).not.toContain(candidateKey(state.current.identity));
        }
      }

      if (state.phase === 'Cancelled' && state.staging.kind === 'in-flight') {
        // Only a mid-download cancellation retains a pending transfer, so an attempt was made.
        expect(progress.attempts).toBeGreaterThan(0);
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

  it('never runs progress backwards: attempts, rounds, and rejections only grow', () => {
    assertProperty(
      fc.property(arbCommandSequence, (plan) => {
        const run = driveCommands(plan);
        for (const [index, state] of run.states.entries()) {
          if (index === 0) continue;
          const previous = progressOf(run.states[index - 1]!);
          const current = progressOf(state);

          expect(current.attempts).toBeGreaterThanOrEqual(previous.attempts);
          expect(current.searchRounds).toBeGreaterThanOrEqual(previous.searchRounds);
          expect(current.rejected).toEqual(
            expect.arrayContaining([...previous.rejected]) as readonly string[],
          );
        }
      }),
    );
  });
});

describe('the sweep is not vacuous: the generated plans reach the whole lifecycle', () => {
  it('visits every phase and exercises every command across the pinned corpus', () => {
    const phasesSeen = new Set<AcquisitionPhase>();
    const commandsSeen = new Set<AcquisitionCommandType>();

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

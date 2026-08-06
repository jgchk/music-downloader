import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { assertProperty, propertyRun } from '../../__fixtures__/property.js';
import { candidateKey } from '../candidate/candidate.js';
import { decide } from './decide.js';
import type { DomainError } from './decide.js';
import type { AcquisitionCommandType } from './commands.js';
import type { AcquisitionEvent, AcquisitionEventType } from './events.js';
import { initialState, isTerminal } from './state.js';
import type { AcquisitionPhase } from './state.js';
import {
  arbBlindCommandStep,
  arbCommandSequence,
  blindStepArbitraryByCommandType,
  eventArbitraryByType,
} from './__fixtures__/arbitraries.js';
import type { CommandStep } from './__fixtures__/arbitraries.js';
import {
  ABSORBING_PHASES,
  arbReachableStates,
  driveCommands,
  progressOf,
} from './__fixtures__/decider-runner.js';
import type { DriveResult } from './__fixtures__/decider-runner.js';

/**
 * Property suite for the acquisition decider (decider-properties D1): universally-quantified
 * relations over generated command sequences, driven through the real `decide`/`evolve`. These
 * supplement — never replace — the BDD example tests next door, which remain the readable
 * specification; this is the adversarial sweep behind them.
 *
 * Every property whose assertion sits behind a guard carries a counter, asserted non-zero after the
 * sweep: a property that never reaches its assertion is worse than no property, and a guard is
 * exactly how that happens silently.
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
 * The commands that may answer a *terminal* state with an error — not "the commands a caller
 * issues": `CancelAcquisition` is caller-issued too, and converges on a settled acquisition. These
 * two are the ones whose refusal the caller must learn about (a submission onto a live stream is a
 * duplicate; an edition choice that arrives too late did nothing). Every other command except
 * `CancelAcquisition` is an effect *result* re-entering, and a result that arrives after the
 * acquisition settled is late news, not a protocol violation; a cancellation of something already
 * settled is simply redundant, so it converges too.
 */
const REFUSABLE_ON_TERMINAL: ReadonlySet<AcquisitionCommandType> = new Set<AcquisitionCommandType>([
  'SubmitAcquisition',
  'SelectEdition',
]);

/**
 * The closed `DomainError` union, as an exhaustive `Record` so a new error kind is a compile error
 * here — a hand-written list would neither fail to compile nor fail the "every kind reached" sweep.
 */
const DOMAIN_ERROR_KIND_TABLE: Record<DomainError['kind'], true> = {
  AlreadyExists: true,
  IllegalTransition: true,
  UnknownEdition: true,
};
const DOMAIN_ERROR_KINDS: readonly DomainError['kind'][] = Object.keys(
  DOMAIN_ERROR_KIND_TABLE,
) as DomainError['kind'][];

const KNOWN_EVENT_TYPES: readonly string[] = Object.keys(eventArbitraryByType);

/** Sort names so the coverage assertions compare sets, not incidental insertion order. */
const byName = (a: string, b: string): number => a.localeCompare(b);

describe('the generators cover the decider’s whole command and event surface', () => {
  it('generates every event variant, and only under its own key', () => {
    for (const [type, arbitrary] of Object.entries<fc.Arbitrary<AcquisitionEvent>>(
      eventArbitraryByType,
    )) {
      const samples = fc.sample(arbitrary, { numRuns: 10, seed: propertyRun.seed });

      expect(samples.map((event) => event.type)).toEqual(
        Array.from({ length: samples.length }, () => type as AcquisitionEventType),
      );
    }
  });

  it('generates every command variant, and only under its own key', () => {
    for (const [type, arbitrary] of Object.entries<fc.Arbitrary<CommandStep>>(
      blindStepArbitraryByCommandType,
    )) {
      const samples = fc.sample(arbitrary, { numRuns: 10, seed: propertyRun.seed });

      expect(samples.map((step) => step(initialState).type)).toEqual(
        Array.from({ length: samples.length }, () => type as AcquisitionCommandType),
      );
    }
  });
});

describe('decide is total: every reachable state answers every command with a value', () => {
  it('never throws, on any command against any state a stream can reach', () => {
    assertProperty(
      // `arbReachableStates` — not merely the decider's own output — so the corrupted-stream
      // register is in play here too: a command landing on a state assembled from a hand-edited
      // history is exactly what a partial `decide` would die on.
      fc.property(arbReachableStates, arbBlindCommandStep, (states, intruder) => {
        for (const state of states) {
          expect(() => decide(intruder(state), state)).not.toThrow();
        }
      }),
    );
  });

  it('answers only in its declared channels: modelled errors, or events of known types', () => {
    // `isOk() || isErr()` would be true by construction and assert nothing. What is worth pinning
    // is that the *contents* stay inside the declared unions — an unmodelled error kind or an
    // unknown event type is a real failure the type does not catch at runtime.
    assertProperty(
      fc.property(arbReachableStates, arbBlindCommandStep, (states, intruder) => {
        for (const state of states) {
          const decision = decide(intruder(state), state);

          if (decision.isErr()) {
            expect(DOMAIN_ERROR_KINDS).toContain(decision.error.kind);
            continue;
          }
          for (const event of decision.value) {
            expect(KNOWN_EVENT_TYPES).toContain(event.type);
          }
        }
      }),
    );
  });
});

describe('a settled acquisition converges: late effect results are absorbed, not refused', () => {
  it('answers every effect-result command on a terminal state without an error', () => {
    let terminalsProbed = 0;

    assertProperty(
      fc.property(arbCommandSequence, arbBlindCommandStep, (plan, intruder) => {
        for (const state of driveCommands(plan).states) {
          if (!isTerminal(state)) continue;
          const command = intruder(state);
          if (REFUSABLE_ON_TERMINAL.has(command.type)) continue;
          terminalsProbed += 1;

          // Events are lawful here — a cancelled acquisition whose in-flight transfer finally
          // settles still owes one rejection so the staged files get cleaned up. An error is not.
          expect(decide(command, state).isErr()).toBe(false);
        }
      }),
    );

    expect(terminalsProbed).toBeGreaterThan(0);
  });

  it('never re-enters an active phase from an absorbing terminal', () => {
    let absorptionsObserved = 0;

    assertProperty(
      fc.property(arbCommandSequence, (plan) => {
        const phases = driveCommands(plan).states.map((state) => state.phase);
        const settledAt = phases.findIndex((phase) => ABSORBING_PHASES.has(phase));
        if (settledAt === -1) return;
        absorptionsObserved += 1;

        expect(phases.slice(settledAt)).toEqual(
          Array.from({ length: phases.length - settledAt }, () => phases[settledAt]),
        );
      }),
    );

    expect(absorptionsObserved).toBeGreaterThan(0);
  });
});

describe('the one defeasible edge: an external verdict may revive a fulfilment', () => {
  it('revives on an exactly-referring verdict and converges on any other', () => {
    // `Fulfilled` is terminal for every existing purpose yet stable-but-defeasible
    // (fulfillment-external-verdict D2): this single command may reopen it. Asserting only
    // "does not error" would leave a decider that never revives at all looking perfectly healthy —
    // so both sides of the guard are pinned, each with its own counter.
    let revivals = 0;
    let convergences = 0;

    assertProperty(
      fc.property(arbCommandSequence, (plan) => {
        for (const state of driveCommands(plan).states) {
          if (state.phase !== 'Fulfilled') continue;
          const resume = state.resume;
          if (resume === undefined) continue; // a legacy fulfilment names no candidate to judge

          const identity = resume.candidate.identity;
          const revived = decide(
            {
              type: 'RecordExternalValidationFailed',
              candidate: { username: identity.username, path: identity.path },
              reasons: ['judged unacceptable downstream'],
            },
            state,
          )._unsafeUnwrap();

          revivals += 1;
          // The exact reject-and-advance shape of every other rejection: the verdict is recorded,
          // the candidate rejected so its files are cleaned up, and the ladder takes its next move
          // — which is a selection, a fresh search, or exhaustion, and nothing else.
          const [first, second, third, ...rest] = revived.map((event) => event.type);
          expect([first, second]).toEqual(['FulfillmentRejected', 'CandidateRejected']);
          expect(['CandidateSelected', 'SearchRequested', 'AcquisitionExhausted']).toContain(third);
          expect(rest).toEqual([]);

          const stranger = decide(
            {
              type: 'RecordExternalValidationFailed',
              candidate: { username: 'a-stranger', path: 'somewhere/else' },
              reasons: [],
            },
            state,
          )._unsafeUnwrap();

          // Counted separately from `revivals` so each side of the guard has to be reached on its
          // own; incrementing both together would let one arm carry the other.
          if (stranger.length === 0) convergences += 1;
          // A verdict naming someone else is stale news about a candidate this acquisition never
          // delivered — absorbed in silence, never mis-attached to the fulfilled one.
          expect(stranger).toEqual([]);
        }
      }),
    );

    expect(revivals).toBeGreaterThan(0);
    expect(convergences).toBeGreaterThan(0);
  });
});

describe('no reachable state violates an acquisition invariant', () => {
  /** How many times each guarded invariant actually got to assert something. */
  const reached = {
    menu: 0,
    budget: 0,
    working: 0,
    workingNonEmpty: 0,
    inFlight: 0,
    inFlightCancellation: 0,
  };

  /** The invariants types cannot express, checked on every state the fold passes through. */
  function expectInvariants(run: DriveResult): void {
    for (const state of run.states) {
      if (state.phase === 'AwaitingManualSelection') {
        reached.menu += 1;
        // The pause can never be a dead end: an empty menu is no choice at all.
        expect(state.candidates.length).toBeGreaterThan(0);
        // Manual selection exists only for release groups — the resume's assumption is unforgeable.
        expect(state.request.kind).toBe('release-group');
      }

      const progress = progressOf(state);
      if ('policies' in state) {
        reached.budget += 1;
        expect(progress.attempts).toBeLessThanOrEqual(state.policies.retry.maxTotalAttempts);
        expect(progress.searchRounds).toBeLessThanOrEqual(state.policies.retry.maxSearchRounds);
      }

      if ('working' in state) {
        reached.working += 1;
        const workingKeys = state.working.map((ranked) => candidateKey(ranked.candidate.identity));
        if (workingKeys.length > 0) reached.workingNonEmpty += 1;
        // A rejected candidate is never offered again.
        expect(workingKeys.filter((key) => progress.rejected.includes(key))).toEqual([]);
        // The candidate in flight has left the untried set — it can never be selected twice.
        if ('current' in state) {
          reached.inFlight += 1;
          expect(workingKeys).not.toContain(candidateKey(state.current.identity));
        }
      }

      if (state.phase === 'Cancelled' && state.staging.kind === 'in-flight') {
        reached.inFlightCancellation += 1;
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

    // Each invariant sits behind a phase guard; without these the suite could go green having
    // asserted nothing at all.
    expect(reached.menu).toBeGreaterThan(0);
    expect(reached.budget).toBeGreaterThan(0);
    expect(reached.working).toBeGreaterThan(0);
    expect(reached.workingNonEmpty).toBeGreaterThan(0);
    expect(reached.inFlight).toBeGreaterThan(0);
    expect(reached.inFlightCancellation).toBeGreaterThan(0);
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
          // The rejected set is append-only: every earlier key still there, in place. (An
          // `arrayContaining` matcher would pass trivially whenever the earlier set was empty.)
          expect(current.rejected.slice(0, previous.rejected.length)).toEqual(previous.rejected);
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

  it('refuses as well as accepts — every modelled error kind is genuinely reached', () => {
    const kindsSeen = new Set<DomainError['kind']>();

    assertProperty(
      fc.property(arbCommandSequence, (plan) => {
        for (const decision of driveCommands(plan).decisions) {
          if (decision.outcome.isErr()) kindsSeen.add(decision.outcome.error.kind);
        }
      }),
    );

    expect([...kindsSeen].toSorted(byName)).toEqual([...DOMAIN_ERROR_KINDS].toSorted(byName));
  });
});

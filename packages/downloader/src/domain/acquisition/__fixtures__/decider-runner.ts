import fc from 'fast-check';
import type { AcquisitionCommand } from '../commands.js';
import { decide } from '../decide.js';
import type { DomainError } from '../decide.js';
import type { AcquisitionEvent } from '../events.js';
import { evolve, initialState } from '../state.js';
import type { AcquisitionPhase, AcquisitionState } from '../state.js';
import { arbCommandSequence, arbEvent, arbEventHistory } from './arbitraries.js';
import type { CommandStep } from './arbitraries.js';

/**
 * Drives a generated command plan through the real decide -> evolve loop, exactly as the
 * application's command handler does, and records everything a property needs to judge the run.
 *
 * Test support for the property suites: it makes no assertions of its own, so a property that
 * reads its output is reading the decider's honest behaviour and nothing else.
 */

/** One command's turn: what was asked, and what the decider answered. */
export interface DecisionRecord {
  readonly command: AcquisitionCommand;
  /** The state the command was decided against. */
  readonly before: AcquisitionState;
  readonly emitted: readonly AcquisitionEvent[];
  readonly error?: DomainError;
}

export interface DriveResult {
  /** The append-only history the plan produced. */
  readonly events: readonly AcquisitionEvent[];
  /**
   * Every state the fold passed through, including the mid-batch ones. Co-emitted batches make
   * transient phases (notably `Selecting`) real states the reactor observes, so the invariants are
   * judged on the prefix folds, not only on the resting state after each command.
   */
  readonly states: readonly AcquisitionState[];
  readonly decisions: readonly DecisionRecord[];
  readonly finalState: AcquisitionState;
}

export function driveCommands(steps: readonly CommandStep[]): DriveResult {
  let state: AcquisitionState = initialState;
  const events: AcquisitionEvent[] = [];
  const states: AcquisitionState[] = [state];
  const decisions: DecisionRecord[] = [];

  for (const step of steps) {
    const command = step(state);
    const before = state;
    const decision = decide(command, state);
    if (decision.isErr()) {
      decisions.push({ command, before, emitted: [], error: decision.error });
      continue;
    }
    for (const event of decision.value) {
      state = evolve(state, event);
      events.push(event);
      states.push(state);
    }
    decisions.push({ command, before, emitted: decision.value });
  }

  return { events, states, decisions, finalState: state };
}

/** The progress counters, read uniformly across phases (`Empty` carries none). */
export function progressOf(state: AcquisitionState): {
  readonly attempts: number;
  readonly searchRounds: number;
  readonly rejected: readonly string[];
} {
  if (state.phase === 'Empty') return { attempts: 0, searchRounds: 0, rejected: [] };
  return { attempts: state.attempts, searchRounds: state.searchRounds, rejected: state.rejected };
}

/**
 * The terminal phases that truly absorb. `Fulfilled` is excluded by design: it is terminal for
 * every existing purpose yet stable-but-*defeasible* — one external verdict may revive it
 * (fulfillment-external-verdict D2), and that single edge is asserted separately rather than
 * weakened into this set.
 */
export const ABSORBING_PHASES: ReadonlySet<AcquisitionPhase> = new Set<AcquisitionPhase>([
  'Exhausted',
  'Cancelled',
  'MetadataFailed',
  'Conflicted',
]);

// --- History registers ---------------------------------------------------------------------------

/** A well-formed history: exactly what the decider minted, nothing else. */
export const arbDecidedHistory: fc.Arbitrary<readonly AcquisitionEvent[]> = arbCommandSequence.map(
  (plan) => driveCommands(plan).events,
);

/**
 * A well-formed history with out-of-protocol events spliced in — a stream that was corrupted or
 * hand-edited *after* the acquisition got somewhere interesting.
 *
 * This register exists because neither of the other two reaches the hard cases on its own: pure
 * event soup essentially never assembles the four-event chain that reaches `Selecting`, and a
 * decided history contains no illegal pairing by construction. Splicing is what puts an impossible
 * event onto a deep phase, which is precisely where a fold that is only *nearly* total breaks.
 */
export const arbCorruptedHistory: fc.Arbitrary<readonly AcquisitionEvent[]> = fc
  .tuple(arbDecidedHistory, fc.array(fc.tuple(fc.nat(), arbEvent), { minLength: 1, maxLength: 4 }))
  .map(([decided, splices]) => {
    const history = [...decided];
    for (const [position, event] of splices) {
      history.splice(position % (history.length + 1), 0, event);
    }
    return history;
  });

/** Every register at once: the fold owes its guarantees to all three. */
export const arbAnyHistory: fc.Arbitrary<readonly AcquisitionEvent[]> = fc.oneof(
  arbEventHistory,
  arbDecidedHistory,
  arbCorruptedHistory,
);

/** Every state a history passes through, the initial one included. */
export function prefixStates(history: readonly AcquisitionEvent[]): readonly AcquisitionState[] {
  const states: AcquisitionState[] = [initialState];
  let state: AcquisitionState = initialState;
  for (const event of history) {
    state = evolve(state, event);
    states.push(state);
  }
  return states;
}

/**
 * Every state one generated history reaches — the quantifier the totality properties need.
 *
 * Folding a history to its *final* state only ever offers a resting phase, and the transient ones
 * (`Selecting`, above all) exist only mid-batch. Since a partial fold breaks precisely where an
 * impossible event meets a phase nobody wrote a case for, the property has to see all of them.
 */
export const arbReachableStates: fc.Arbitrary<readonly AcquisitionState[]> =
  arbAnyHistory.map(prefixStates);

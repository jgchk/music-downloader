import fc from 'fast-check';
import type { ImportCommand } from '../commands.js';
import { decide } from '../decide.js';
import type { DomainError } from '../decide.js';
import type { ImportEvent } from '../events.js';
import { evolve, initialState } from '../state.js';
import type { ImportState } from '../state.js';
import { arbCommandSequence, arbEvent, arbEventHistory } from './arbitraries.js';
import type { CommandStep } from './arbitraries.js';

/**
 * Drives a generated command plan through the real decide -> evolve loop, exactly as the
 * application's command handler does, and records everything a property needs to judge the run.
 * The twin of the acquisition runner in the other context; it makes no assertions of its own.
 */

/** One command's turn: what was asked, and what the decider answered. */
export interface DecisionRecord {
  readonly command: ImportCommand;
  /** The state the command was decided against. */
  readonly before: ImportState;
  readonly emitted: readonly ImportEvent[];
  readonly error?: DomainError;
}

export interface DriveResult {
  readonly events: readonly ImportEvent[];
  /** Every state the fold passed through, mid-batch ones included. */
  readonly states: readonly ImportState[];
  readonly decisions: readonly DecisionRecord[];
  readonly finalState: ImportState;
}

export function driveCommands(steps: readonly CommandStep[]): DriveResult {
  let state: ImportState = initialState;
  const events: ImportEvent[] = [];
  const states: ImportState[] = [state];
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

/** The stream's seam convergence watermark, read uniformly across phases (`empty` carries none). */
export function watermarkOf(state: ImportState): number | undefined {
  return state.phase === 'empty' ? undefined : state.seamWatermark;
}

// --- History registers ---------------------------------------------------------------------------

/** A well-formed history: exactly what the decider minted, nothing else. */
export const arbDecidedHistory: fc.Arbitrary<readonly ImportEvent[]> = arbCommandSequence.map(
  (plan) => driveCommands(plan).events,
);

/**
 * A well-formed history with out-of-protocol events spliced in — a stream corrupted or hand-edited
 * *after* the import got somewhere interesting. Neither of the other registers reaches an
 * impossible event on a deep phase, which is exactly where a nearly-total fold breaks.
 */
export const arbCorruptedHistory: fc.Arbitrary<readonly ImportEvent[]> = fc
  .tuple(arbDecidedHistory, fc.array(fc.tuple(fc.nat(), arbEvent), { minLength: 1, maxLength: 4 }))
  .map(([decided, splices]) => {
    const history = [...decided];
    for (const [position, event] of splices) {
      history.splice(position % (history.length + 1), 0, event);
    }
    return history;
  });

/** Every register at once: the fold owes its guarantees to all three. */
export const arbAnyHistory: fc.Arbitrary<readonly ImportEvent[]> = fc.oneof(
  arbEventHistory,
  arbDecidedHistory,
  arbCorruptedHistory,
);

/** Every state a history passes through, the initial one included. */
export function prefixStates(history: readonly ImportEvent[]): readonly ImportState[] {
  const states: ImportState[] = [initialState];
  let state: ImportState = initialState;
  for (const event of history) {
    state = evolve(state, event);
    states.push(state);
  }
  return states;
}

/**
 * Every state one generated history reaches — the quantifier the totality properties need. A final
 * fold only ever offers a resting phase, and a partial fold breaks precisely where an impossible
 * event meets a phase nobody wrote a case for.
 */
export const arbReachableStates: fc.Arbitrary<readonly ImportState[]> =
  arbAnyHistory.map(prefixStates);

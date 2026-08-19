import fc from 'fast-check';
import type { Result } from 'neverthrow';
import type { DownloadCommand } from '../commands.js';
import { decide } from '../decide.js';
import type { DomainError } from '../decide.js';
import type { DownloadEvent } from '../events.js';
import { evolve, initialState } from '../state.js';
import type { DownloadPhase, DownloadState } from '../state.js';
import { arbCommandSequence, arbEvent, arbEventHistory } from './arbitraries.js';
import type { CommandStep } from './arbitraries.js';

/**
 * Drives a generated command plan through the real decide -> evolve loop, exactly as the
 * application's command handler does, and records everything a property needs to judge the run.
 *
 * Test support for the property suites: it makes no assertions of its own, so a property that
 * reads its output is reading the decider's honest behaviour and nothing else.
 */

/**
 * One command's turn: what was asked, and what the decider answered — the answer kept as the
 * `Result` `decide` actually returned.
 *
 * An earlier shape flattened it to `{ emitted; error? }`, which *invented* an illegal state
 * (events alongside an error) that `Result` makes unrepresentable, and then invited a property to
 * police it. That property could only ever assert what this constructor wrote, so it was deleted
 * along with the flattening. Record the outcome; let the type forbid the impossible.
 */
export interface DecisionRecord {
  readonly command: DownloadCommand;
  /** The state the command was decided against. */
  readonly before: DownloadState;
  readonly outcome: Result<readonly DownloadEvent[], DomainError>;
}

export interface DriveResult {
  /** The append-only history the plan produced. */
  readonly events: readonly DownloadEvent[];
  /**
   * Every state the fold passed through, including the mid-batch ones. Co-emitted batches make
   * transient phases (notably `Selecting`) real states the reactor observes, so the invariants are
   * judged on the prefix folds, not only on the resting state after each command.
   */
  readonly states: readonly DownloadState[];
  readonly decisions: readonly DecisionRecord[];
}

export function driveCommands(steps: readonly CommandStep[]): DriveResult {
  let state: DownloadState = initialState;
  const events: DownloadEvent[] = [];
  const states: DownloadState[] = [state];
  const decisions: DecisionRecord[] = [];

  for (const step of steps) {
    const command = step(state);
    const before = state;
    const outcome = decide(command, state);
    decisions.push({ command, before, outcome });
    if (outcome.isErr()) continue;
    for (const event of outcome.value) {
      state = evolve(state, event);
      events.push(event);
      states.push(state);
    }
  }

  return { events, states, decisions };
}

/** The progress counters, read uniformly across phases (`Empty` carries none). */
export function progressOf(state: DownloadState): {
  readonly attempts: number;
  readonly searchRounds: number;
  readonly rejected: readonly string[];
} {
  if (state.phase === 'Empty') return { attempts: 0, searchRounds: 0, rejected: [] };
  return { attempts: state.attempts, searchRounds: state.searchRounds, rejected: state.rejected };
}

const ABSORPTION_BY_PHASE: Record<DownloadPhase, boolean> = {
  Empty: false,
  Pending: false,
  AwaitingManualSelection: false,
  Searching: false,
  Selecting: false,
  Downloading: false,
  Validating: false,
  Importing: false,
  // Terminal for every existing purpose, yet stable-but-*defeasible*: one external verdict may
  // revive it (fulfillment-external-verdict D2). That single edge is asserted on its own rather
  // than weakened into this set — which is why `Fulfilled` is the one `false` that matters.
  Fulfilled: false,
  Exhausted: true,
  Cancelled: true,
  MetadataFailed: true,
  Conflicted: true,
};

/**
 * The terminal phases that truly absorb. Declared as an exhaustive `Record` over the phase union,
 * not a hand-written `Set`: a new phase is then a compile error here, instead of silently
 * defaulting to "not absorbing" and quietly narrowing what the absorption properties assert.
 */
export const ABSORBING_PHASES: ReadonlySet<DownloadPhase> = new Set(
  Object.entries(ABSORPTION_BY_PHASE)
    .filter(([, absorbing]) => absorbing)
    .map(([phase]) => phase as DownloadPhase),
);

// --- History registers ---------------------------------------------------------------------------

/** A well-formed history: exactly what the decider minted, nothing else. */
export const arbDecidedHistory: fc.Arbitrary<readonly DownloadEvent[]> = arbCommandSequence.map(
  (plan) => driveCommands(plan).events,
);

/**
 * A well-formed history with out-of-protocol events spliced in — a stream that was corrupted or
 * hand-edited *after* the download got somewhere interesting.
 *
 * This register exists because neither of the other two reaches the hard cases on its own: pure
 * event soup essentially never assembles the four-event chain that reaches `Selecting`, and a
 * decided history contains no illegal pairing by construction. Splicing is what puts an impossible
 * event onto a deep phase, which is precisely where a fold that is only *nearly* total breaks.
 */
export const arbCorruptedHistory: fc.Arbitrary<readonly DownloadEvent[]> = fc
  .tuple(
    arbDecidedHistory,
    fc.array(fc.tuple(fc.nat(), arbEvent), { minLength: 1, maxLength: 4 }),
    // Always some events AFTER the decided history as well. A random splice position lands at the
    // tail only about one time in n, and the corruption the absorption properties care about is an
    // event arriving *once the stream has settled* — which, when a plan does reach a terminal, is
    // the tail. Leaving that to chance is what let a seeded absorption defect survive a sweep.
    fc.array(arbEvent, { minLength: 1, maxLength: 3 }),
  )
  .map(([decided, splices, tail]) => {
    const history = [...decided];
    for (const [position, event] of splices) {
      history.splice(position % (history.length + 1), 0, event);
    }
    return [...history, ...tail];
  });

/** Every register at once: the fold owes its guarantees to all three. */
export const arbAnyHistory: fc.Arbitrary<readonly DownloadEvent[]> = fc.oneof(
  arbEventHistory,
  arbDecidedHistory,
  arbCorruptedHistory,
);

/** Every state a history passes through, the initial one included. */
export function prefixStates(history: readonly DownloadEvent[]): readonly DownloadState[] {
  const states: DownloadState[] = [initialState];
  let state: DownloadState = initialState;
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
export const arbReachableStates: fc.Arbitrary<readonly DownloadState[]> =
  arbAnyHistory.map(prefixStates);

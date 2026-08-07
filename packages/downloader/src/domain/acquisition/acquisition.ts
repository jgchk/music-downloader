import type { Result } from 'neverthrow';
import type { CandidateIdentity } from '../candidate/candidate.js';
import type { AcquisitionCommand } from './commands.js';
import { decide } from './decide.js';
import type { DomainError } from './decide.js';
import type { AcquisitionEvent, EditionCandidate } from './events.js';
import { react } from './react.js';
import type { Effect } from './react.js';
import { foldEvents, isTerminal } from './state.js';
import type { AcquisitionPhase, AcquisitionState } from './state.js';

/**
 * The acquisition aggregate (D1): the single public face of the acquisition domain. It wraps the
 * functional decider — `decide`/`evolve`/`react` and the folded `AcquisitionState` stay private
 * module internals of this folder, reachable only through this class. The aggregate is pure and
 * immutable: rehydrate a history with {@link Acquisition.fromHistory}, then observe it — nothing
 * here performs I/O or mutates.
 *
 * Commands, events, {@link DomainError}, {@link Effect}, and {@link AcquisitionPhase} remain the
 * public contract (the wire format of the decide/react loop); the write-model state shape and the
 * decision logic are the secrets.
 */
export type { DomainError } from './decide.js';
export type { Effect } from './react.js';
export type { AcquisitionPhase } from './state.js';

/**
 * A read projection of the folded state — the observable facts a query model needs, all of which
 * are already part of the public acquisition-status contract. Distinct from the private
 * write-model `AcquisitionState`, which the aggregate never exposes.
 */
export interface AcquisitionSnapshot {
  readonly phase: AcquisitionPhase;
  /**
   * The transfer is live at the source: the current attempt's enqueue was accepted
   * (`DownloadStarted` folded). The acquisition's own determination — consumers read it instead
   * of re-deriving liveness from the history (nonblocking-download-observation).
   */
  readonly transferStarted: boolean;
  readonly currentCandidate?: CandidateIdentity;
  readonly attempts: number;
  readonly rejectedCount: number;
  readonly location?: string;
  /**
   * The retained candidate editions, present only while awaiting manual selection.
   *
   * "Only while" is an invariant of the state union, not just of this projection: no phase but
   * `AwaitingManualSelection` may carry a `candidates` field, and a new phase that did would be
   * published here by key presence alone. `state.property.test.ts` asserts it over a pinned
   * corpus of generated histories — read that before adding a phase with an edition menu.
   */
  readonly candidates?: readonly EditionCandidate[];
}

/**
 * The in-flight candidate's identity, for phases that track one. Terminal phases only retain it
 * when the candidate's staged files still matter (a conflict, or a cancellation after the transfer
 * settled) — so a cancelled-in-flight or exhausted acquisition reports none.
 */
function currentIdentityOf(state: AcquisitionState): CandidateIdentity | undefined {
  if (state.phase === 'Cancelled')
    return state.staging.kind === 'settled' ? state.staging.current.identity : undefined;
  return 'current' in state ? state.current.identity : undefined;
}

export class Acquisition {
  private constructor(private readonly state: AcquisitionState) {}

  /** Rehydrate an aggregate by folding its event history (the replay path). */
  static fromHistory(events: readonly AcquisitionEvent[]): Acquisition {
    return new Acquisition(foldEvents(events));
  }

  /** Run a command against the current state: the events to append, or a `DomainError`. */
  execute(command: AcquisitionCommand): Result<readonly AcquisitionEvent[], DomainError> {
    return decide(command, this.state);
  }

  /** The reflex: zero or more effect descriptions for an event applied to this state. */
  reactTo(event: AcquisitionEvent): readonly Effect[] {
    return react(event, this.state);
  }

  get phase(): AcquisitionPhase {
    return this.state.phase;
  }

  get isTerminal(): boolean {
    return isTerminal(this.state);
  }

  /** The read-model projection of this aggregate's folded state. */
  get snapshot(): AcquisitionSnapshot {
    const state = this.state;
    return {
      phase: state.phase,
      transferStarted: state.phase === 'Downloading' && state.started,
      currentCandidate: currentIdentityOf(state),
      attempts: 'attempts' in state ? state.attempts : 0,
      rejectedCount: 'rejected' in state ? state.rejected.length : 0,
      location: 'location' in state ? state.location : undefined,
      // Asked the same way as the three lines above. `candidates` is declared on
      // `AwaitingManualSelectionState` alone, so under this union's own rule — each variant carries
      // exactly the fields valid in it — presence of the key IS the discriminant, restated.
      //
      // That equivalence is a property of the FOLD, not of the type, and nothing in the compiler
      // holds it: every exit from AwaitingManualSelection has to drop the key (`EditionSelected`
      // destructures it away; `AcquisitionCancelled` rebuilds field by field), and a `{ ...state }`
      // rewrite of either — the form eight other arms of `evolve` use — would leak a stale menu onto
      // a phase that has none, which this projection would then publish. So it is asserted, over
      // a pinned corpus of histories, by `carries \`candidates\` on no state but AwaitingManualSelection`
      // (state.property.test.ts). Verified to fail without it.
      //
      // Secondary, and not the reason: `in` is also the spelling that stays honestly measurable.
      // A `state.phase === '…'` test yields an equivalent mutant (forced TRUE reads `undefined` on
      // every other phase — exactly what the false arm supplies) welded to killable siblings on the
      // same AST node, and neither a line-scoped waiver nor an ignore-plugin can separate them.
      // `in` is not an operator either mutator rewrites, so that mutant does not exist, while the
      // one that carries the behaviour — emptying the property name so the menu is never carried —
      // remains and is killed by `exposes the retained candidate editions while awaiting a choice`
      // (read-models.test.ts).
      candidates: 'candidates' in state ? state.candidates : undefined,
    };
  }
}

import type { Result } from 'neverthrow';
import type { CandidateIdentity } from '../candidate/candidate.js';
import type { AcquisitionCommand } from './commands.js';
import { decide } from './decide.js';
import type { DomainError } from './decide.js';
import type { AcquisitionEvent } from './events.js';
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
  readonly currentCandidate?: CandidateIdentity;
  readonly attempts: number;
  readonly rejectedCount: number;
  readonly location?: string;
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
    return {
      phase: this.state.phase,
      currentCandidate: this.state.current?.identity,
      attempts: this.state.attempts,
      rejectedCount: this.state.rejected.length,
      location: this.state.location,
    };
  }
}

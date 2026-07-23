import type { Result } from 'neverthrow';
import type { ImportCommand } from './commands.js';
import { decide } from './decide.js';
import type { DomainError } from './decide.js';
import type {
  ImportEvent,
  ProposedCandidate,
  ResolutionKind,
  ReviewCause,
  ReviewKind,
} from './events.js';
import { react } from './react.js';
import type { Effect } from './react.js';
import { foldEvents, isTerminal } from './state.js';
import type { ImportPhase, ImportState } from './state.js';

/**
 * The import aggregate: the single public face of the import domain. It wraps the functional
 * decider — `decide`/`evolve`/`react` and the folded `ImportState` stay private module internals
 * of this folder, reachable only through this class. The aggregate is pure and immutable:
 * rehydrate a history with {@link Import.fromHistory}, then observe it — nothing here performs
 * I/O or mutates.
 *
 * Commands, events, {@link DomainError}, {@link Effect}, and {@link ImportPhase} remain the
 * public contract (the wire format of the decide/react loop); the write-model state shape and the
 * decision logic are the secrets.
 */
export type { DomainError } from './decide.js';
export type { Effect } from './react.js';
export type { ImportPhase } from './state.js';

/** The open review riding on this import, if any — what the pending-reviews queue projects. */
export interface OpenReview {
  readonly cause: ReviewCause;
  readonly candidates: readonly ProposedCandidate[];
  /**
   * The resolution verbs a human may take on this review — the importer's own curation, exposed so a
   * consumer offers exactly the legal verbs rather than re-deriving per-kind legality. Always at
   * least as strict as {@link decide}: it never lists a verb `decide` would refuse (see
   * {@link permittedActionsFor}).
   */
  readonly availableActions: readonly ResolutionKind[];
}

/**
 * The resolution verbs permitted for an open review — the importer's authoritative, curated set. A
 * remediation review resolves only through accept/retry-enrichment; the review kinds offer their
 * curated verb set, with `apply-candidate` present only when candidates exist and
 * `reject-unusable-delivery` only when a delivered candidate is retained (the `NoRetainedCandidate`
 * precondition `decide` enforces). The curation is narrower than the raw `decide`-legal set on
 * purpose (e.g. a duplicate review offers no manual re-tag), and never wider — every verb it lists is
 * one `decide` would accept for that review.
 */
function permittedActionsFor(
  kind: ReviewKind,
  // An options object, not two positional booleans: the two gate different verbs, so a transposed
  // pair would be a behavioural bug the compiler cannot catch.
  {
    hasCandidates,
    hasRetainedCandidate,
  }: { hasCandidates: boolean; hasRetainedCandidate: boolean },
): readonly ResolutionKind[] {
  const isAllowed = (verb: ResolutionKind): boolean =>
    (verb !== 'apply-candidate' || hasCandidates) &&
    (verb !== 'reject-unusable-delivery' || hasRetainedCandidate);
  switch (kind) {
    case 'match-review':
    case 'no-match': {
      return (
        [
          'apply-candidate',
          'supply-id',
          'refresh-candidates',
          'manual-tags',
          'import-as-is',
          'reject',
          'reject-unusable-delivery',
        ] as const
      ).filter((verb) => isAllowed(verb));
    }
    case 'duplicate-review': {
      return (['apply-candidate', 'reject', 'reject-unusable-delivery'] as const).filter((verb) =>
        isAllowed(verb),
      );
    }
    case 'remediation-review': {
      return ['accept', 'retry-enrichment'];
    }
  }
}

/**
 * A read projection of the folded state — the observable facts a query model needs, all of which
 * are already part of the public import-status contract. Distinct from the private write-model
 * `ImportState`, which the aggregate never exposes.
 */
export interface ImportSnapshot {
  readonly phase: ImportPhase;
  readonly directory?: string;
  readonly location?: string;
  readonly openReview?: OpenReview;
  readonly rejection?: { readonly reason: string; readonly filesDeleted: boolean };
}

function openReviewOf(state: ImportState): OpenReview | undefined {
  if (state.phase === 'awaiting-review' && state.settled === undefined) {
    return {
      cause: state.cause,
      candidates: state.candidates,
      availableActions: permittedActionsFor(state.cause.kind, {
        hasCandidates: state.candidates.length > 0,
        hasRetainedCandidate: state.source?.candidate !== undefined,
      }),
    };
  }
  if (state.phase === 'applied' && state.remediation?.status === 'open') {
    return {
      cause: { kind: 'remediation-review', failures: state.remediation.failures },
      candidates: [],
      availableActions: permittedActionsFor('remediation-review', {
        hasCandidates: false,
        hasRetainedCandidate: false,
      }),
    };
  }
  return undefined;
}

export class Import {
  private constructor(private readonly state: ImportState) {}

  /** Rehydrate an aggregate by folding its event history (the replay path). */
  static fromHistory(events: readonly ImportEvent[]): Import {
    return new Import(foldEvents(events));
  }

  /** Run a command against the current state: the events to append, or a `DomainError`. */
  execute(command: ImportCommand): Result<readonly ImportEvent[], DomainError> {
    return decide(command, this.state);
  }

  /** The reflex: zero or more effect descriptions for an event applied to this state. */
  reactTo(event: ImportEvent): readonly Effect[] {
    return react(event, this.state);
  }

  get phase(): ImportPhase {
    return this.state.phase;
  }

  get isTerminal(): boolean {
    return isTerminal(this.state);
  }

  /** The read-model projection of this aggregate's folded state. */
  get snapshot(): ImportSnapshot {
    const state = this.state;
    return {
      phase: state.phase,
      directory: 'directory' in state ? state.directory : undefined,
      location: state.phase === 'applied' ? state.location : undefined,
      openReview: openReviewOf(state),
      rejection:
        state.phase === 'rejected'
          ? { reason: state.reason, filesDeleted: state.filesDeleted }
          : undefined,
    };
  }
}

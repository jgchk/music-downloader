import type { ApplyMode, ImportEvent } from './events.js';
import { hasRemediation } from './state.js';
import type { ImportState } from './state.js';

/**
 * `react` is the reflex: a pure, trivial map from an event to zero or more `Effect`
 * *descriptions*. It makes no decisions and performs no I/O — the imperative shell interprets
 * each Effect by calling a port and feeds the result back through `decide` as a command.
 */
export type Effect =
  | {
      readonly type: 'Propose';
      readonly directory: string;
      readonly searchId?: string;
      readonly searchArtist?: string;
      readonly searchAlbum?: string;
    }
  | { readonly type: 'Apply'; readonly directory: string; readonly mode: ApplyMode }
  | { readonly type: 'DeleteIntake'; readonly directory: string };

/**
 * `state` is the state *as of* `event`: the fold of the stream prefix up to and including it (the
 * reactor slices the stream before reacting). The phase narrowings below are refinements over the
 * state union; for a well-formed history each guard's phase is implied by the event just folded,
 * and a pairing that does not match falls through to no effects — consistent with `evolve`'s
 * tolerant fold. Re-firing under redelivery is safe by contract, not by suppression here: effects
 * are idempotent at the port and their follow-on commands pass back through `decide`, which
 * rejects stale outcomes.
 */
export function react(event: ImportEvent, state: ImportState): readonly Effect[] {
  switch (event.type) {
    case 'ImportRequested': {
      return [
        {
          type: 'Propose',
          directory: event.directory,
          searchId: event.hints?.mbReleaseId,
          searchArtist: event.hints?.artist,
          searchAlbum: event.hints?.album,
        },
      ];
    }
    case 'AutoApplySelected': {
      return state.phase === 'applying'
        ? [{ type: 'Apply', directory: state.directory, mode: state.mode }]
        : [];
    }
    case 'ReviewResolved': {
      switch (event.resolution.kind) {
        case 'apply-candidate':
        case 'import-as-is':
        case 'manual-tags': {
          return state.phase === 'applying'
            ? [{ type: 'Apply', directory: state.directory, mode: state.mode }]
            : [];
        }
        case 'supply-id': {
          return state.phase === 'proposing'
            ? [
                {
                  type: 'Propose',
                  directory: state.directory,
                  searchId: event.resolution.mbReleaseId,
                },
              ]
            : [];
        }
        case 'refresh-candidates': {
          return state.phase === 'proposing'
            ? [{ type: 'Propose', directory: state.directory }]
            : [];
        }
        case 'reject':
        case 'reject-unusable-delivery': {
          // Both rejection verbs owe the same intake hygiene; the release verdict is a record-only
          // fact, never an effect here.
          return state.phase === 'awaiting-review'
            ? [{ type: 'DeleteIntake', directory: state.directory }]
            : [];
        }
        case 'retry-enrichment': {
          // Re-run beets over the already-imported location: a deterministic in-place re-import
          // that re-fires the full plugin chain against files beets already owns.
          return hasRemediation(state, 'retrying')
            ? [{ type: 'Apply', directory: state.location, mode: state.mode }]
            : [];
        }
        // Stryker disable next-line StringLiteral,ConditionalExpression,BlockStatement: equivalent —
        // this arm falls through to one that returns the same `[]`. Proof, in full:
        // This is the last arm of the inner switch, and control leaving that switch falls straight
        // through into the outer switch's next case group — the no-effect arm that also returns
        // `[]`. So emptying this body, deleting it, or making the label unmatchable all reach the
        // same `[]` by the longer road. It is written out because relying on a fall-through across
        // two switch levels to state "accept closes the review, nothing to run" is not readable.
        case 'accept': {
          return [];
        }
      }
    }

    case 'MatchesProposed':
    case 'ReviewRequired':
    case 'ImportApplied':
    case 'RemediationRequired':
    case 'ImportRejected':
    case 'ReleaseVerdictRecorded': {
      return [];
    }
  }
  // A tag outside the union can only reach here from a log written by a newer version of this
  // module — the storage seam passes an unrecognized token through rather than losing the event.
  // Ignoring it keeps replay total, which the aggregate's contract requires. The switch above is
  // still exhaustively checked: a union member with no case would not narrow to `never` here.
  event satisfies never;
  return [];
}

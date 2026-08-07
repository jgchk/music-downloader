import type { ResultAsync } from 'neverthrow';
import type { Effect } from '../../domain/import/import.js';
import type { StoredEvent } from '../ports/event-store-port.js';
import type { IntakePort, TaggerPort } from '../ports/outbound-ports.js';
import type { OperationScope } from '../correlation/context.js';
import { applyCommand } from './command-handler.js';
import type { CommandDependencies, CommandError } from './command-handler.js';

/**
 * The imperative shell: interpret one Effect by calling its port, translate the raw result into a
 * command through the anti-corruption boundary, and re-enter `decide` via `applyCommand`. Business
 * outcomes become commands; infrastructure faults propagate as `Err` for the reactor to retry.
 * Returns the events the follow-on command appended (so the reactor can chain reactions). Bridge
 * serialization lives in the tagger adapter, so proposals and applies queue one at a time no
 * matter how many effects arrive.
 */
export interface EffectPorts {
  readonly tagger: TaggerPort;
  readonly intake: IntakePort;
}

export interface InterpreterDependencies extends CommandDependencies {
  readonly ports: EffectPorts;
}

export function interpretEffect(
  dependencies: InterpreterDependencies,
  importId: string,
  effect: Effect,
  scope: OperationScope,
): ResultAsync<readonly StoredEvent[], CommandError> {
  const { ports } = dependencies;
  switch (effect.type) {
    case 'Propose': {
      return ports.tagger
        .propose(
          effect.directory,
          {
            searchId: effect.searchId,
            searchArtist: effect.searchArtist,
            searchAlbum: effect.searchAlbum,
          },
          scope,
        )
        .andThen((outcome) =>
          applyCommand(
            dependencies,
            importId,
            outcome.kind === 'proposal'
              ? {
                  type: 'RecordProposal',
                  candidates: outcome.candidates,
                  duplicates: outcome.duplicates,
                  pinnedId: effect.searchId,
                }
              : { type: 'RecordDoomed', reason: outcome.reason },
            scope.context,
          ),
        );
    }

    case 'Apply': {
      return ports.tagger.apply(effect.directory, effect.mode, scope).andThen((outcome) => {
        switch (outcome.kind) {
          case 'applied': {
            return applyCommand(
              dependencies,
              importId,
              {
                type: 'RecordApplied',
                location: outcome.location,
                failures: outcome.failures,
              },
              scope.context,
            );
          }
          case 'skipped-duplicate': {
            return applyCommand(
              dependencies,
              importId,
              {
                type: 'RecordApplySkippedDuplicate',
                incumbents: outcome.incumbents,
              },
              scope.context,
            );
          }
          case 'doomed': {
            return applyCommand(
              dependencies,
              importId,
              {
                type: 'RecordDoomed',
                reason: outcome.reason,
              },
              scope.context,
            );
          }
        }
      });
    }

    case 'DeleteIntake': {
      return ports.intake
        .deleteRelease(effect.directory, scope)
        .andThen(() =>
          applyCommand(dependencies, importId, { type: 'RecordIntakeDeleted' }, scope.context),
        );
    }
  }
}

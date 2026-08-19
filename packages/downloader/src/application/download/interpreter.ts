import type { ResultAsync } from 'neverthrow';
import type { Effect } from '../../domain/download/download.js';
import type { StoredEvent } from '../ports/event-store-port.js';
import type {
  AudioProbePort,
  TransferPort,
  LibraryPort,
  MetadataPort,
  SearchPort,
} from '../ports/outbound-ports.js';
import type { MetadataResolution } from '../ports/outbound-ports.js';
import type { DownloadCommand } from '../../domain/download/commands.js';
import type { OperationScope } from '../correlation/context.js';
import { applyCommand } from './command-handler.js';
import type { CommandDependencies, CommandError } from './command-handler.js';
import { runValidation } from './validation-service.js';

/**
 * The imperative shell (D2): interpret one Effect by calling its port, translate the raw result
 * into a command through the anti-corruption boundary, and re-enter `decide` via `applyCommand`.
 * Business outcomes become commands; infrastructure faults propagate as `Err` for the reactor to
 * retry. Returns the events the follow-on command appended (so the reactor can chain reactions).
 */
export interface EffectPorts {
  readonly metadata: MetadataPort;
  readonly search: SearchPort;
  readonly download: TransferPort;
  readonly probe: AudioProbePort;
  readonly library: LibraryPort;
}

export interface InterpreterDependencies extends CommandDependencies {
  readonly ports: EffectPorts;
}

/** Each resolution outcome re-enters `decide` as its own command (manual-edition-selection D2). */
function resolutionCommand(resolution: MetadataResolution): DownloadCommand {
  switch (resolution.kind) {
    case 'resolved': {
      return { type: 'RecordTarget', target: resolution.target };
    }
    case 'needsSelection': {
      return { type: 'RecordManualSelectionRequested', candidates: resolution.candidates };
    }
    case 'unresolved': {
      return { type: 'RecordMetadataFailed' };
    }
  }
}

export function interpretEffect(
  dependencies: InterpreterDependencies,
  acquisitionId: string,
  effect: Effect,
  scope: OperationScope,
): ResultAsync<readonly StoredEvent[], CommandError> {
  const { ports } = dependencies;
  switch (effect.type) {
    case 'ResolveMetadata': {
      return ports.metadata
        .resolve(effect.request, scope)
        .andThen((resolution) =>
          applyCommand(dependencies, acquisitionId, resolutionCommand(resolution), scope.context),
        );
    }

    case 'Search': {
      return ports.search
        .search(acquisitionId, effect.target, effect.round, scope)
        .andThen((candidates) =>
          applyCommand(
            dependencies,
            acquisitionId,
            { type: 'RecordSearchResults', candidates },
            scope.context,
          ),
        );
    }

    case 'Download': {
      // The ensure-start (nonblocking-download-observation D1): a short call that reconciles,
      // enqueues if the source holds nothing, and registers the supervisor's watch. Only the
      // source refusing THIS candidate is an outcome here; the settled outcome arrives later
      // through the download-outcome consumer. Idempotent, so live redelivery and the startup
      // re-drive re-dispatch it freely.
      return ports.download
        .start(acquisitionId, effect.candidate, effect.policy, scope)
        .andThen((started) =>
          applyCommand(
            dependencies,
            acquisitionId,
            started.kind === 'started'
              ? { type: 'RecordDownloadStarted', candidate: effect.candidate.identity }
              : {
                  type: 'RecordDownloadFailed',
                  reason: started.reason,
                  candidate: effect.candidate.identity,
                },
            scope.context,
          ),
        );
    }

    case 'Validate': {
      return runValidation(
        ports.probe,
        effect.files,
        effect.target,
        effect.matchPolicy,
        scope,
      ).andThen((result) =>
        applyCommand(
          dependencies,
          acquisitionId,
          result.passed
            ? { type: 'RecordValidationPassed', verdict: result.verdict }
            : { type: 'RecordValidationFailed', verdict: result.verdict },
          scope.context,
        ),
      );
    }

    case 'Import': {
      return ports.library
        .import(effect.files, effect.target, scope)
        .andThen((result) =>
          applyCommand(
            dependencies,
            acquisitionId,
            result.kind === 'imported'
              ? { type: 'RecordImported', location: result.location }
              : { type: 'RecordImportConflict', location: result.location },
            scope.context,
          ),
        );
    }

    case 'Cleanup': {
      return ports.library
        .discardStaging(effect.files, scope)
        .map((): readonly StoredEvent[] => []);
    }

    case 'AbortDownload': {
      // Stop the in-flight transfer, then feed the settlement back as a failed outcome. `decide`
      // turns it into the pending candidate's rejection (staging cleanup follows via `react`); the
      // reported reason is immaterial there, so a plain `Cancelled` stands in. The abort reports the
      // subset the source already completed into staging, so its files are cleaned too (design D2).
      return ports.download.abort(acquisitionId, effect.candidate, scope).andThen((files) =>
        applyCommand(
          dependencies,
          acquisitionId,
          {
            type: 'RecordDownloadFailed',
            // Stryker disable next-line StringLiteral: equivalent — an unread argument. This effect
            // is emitted only by the `DownloadCancelled` reaction, so the stream is in the
            // terminal `Cancelled` phase whenever the command lands (redelivery included), and that
            // arm of `decide` settles the pending candidate with a `CandidateRejected` alone — no
            // `TryFailed` carrying a reason is ever emitted. The field is required by the
            // command type, so it cannot be dropped; it is stated truthfully rather than left blank.
            reason: 'Cancelled',
            files,
            candidate: effect.candidate.identity,
          },
          scope.context,
        ),
      );
    }
  }
}

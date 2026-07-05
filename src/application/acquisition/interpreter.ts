import type { ResultAsync } from 'neverthrow';
import type { CandidateIdentity } from '../../domain/candidate/candidate.js';
import type { Effect } from '../../domain/acquisition/acquisition.js';
import type { StoredEvent } from '../ports/event-store-port.js';
import type {
  AudioProbePort,
  DownloadPort,
  DownloadProgress,
  LibraryPort,
  MetadataPort,
  SearchPort,
} from '../ports/outbound-ports.js';
import { applyCommand } from './command-handler.js';
import type { CommandDeps, CommandError } from './command-handler.js';
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
  readonly download: DownloadPort;
  readonly probe: AudioProbePort;
  readonly library: LibraryPort;
}

export interface InterpreterDeps extends CommandDeps {
  readonly ports: EffectPorts;
  readonly onProgress: (
    acquisitionId: string,
    candidate: CandidateIdentity,
    progress: DownloadProgress,
  ) => void;
}

export function interpretEffect(
  deps: InterpreterDeps,
  acquisitionId: string,
  effect: Effect,
): ResultAsync<readonly StoredEvent[], CommandError> {
  const { ports } = deps;
  switch (effect.type) {
    case 'ResolveMetadata':
      return ports.metadata
        .resolve(effect.request)
        .andThen((resolution) =>
          applyCommand(
            deps,
            acquisitionId,
            resolution.kind === 'resolved'
              ? { type: 'RecordTarget', target: resolution.target }
              : { type: 'RecordMetadataFailed' },
          ),
        );

    case 'Search':
      return ports.search
        .search(acquisitionId, effect.target, effect.round)
        .andThen((candidates) =>
          applyCommand(deps, acquisitionId, { type: 'RecordSearchResults', candidates }),
        );

    case 'Download':
      return ports.download
        .download(acquisitionId, effect.candidate, effect.policy, (progress) =>
          deps.onProgress(acquisitionId, effect.candidate.identity, progress),
        )
        .andThen((result) =>
          applyCommand(
            deps,
            acquisitionId,
            result.kind === 'completed'
              ? { type: 'RecordDownloadCompleted', files: result.files }
              : { type: 'RecordDownloadFailed', reason: result.reason },
          ),
        );

    case 'Validate':
      return runValidation(ports.probe, effect.files, effect.target, effect.matchPolicy).andThen(
        (result) =>
          applyCommand(
            deps,
            acquisitionId,
            result.passed
              ? { type: 'RecordValidationPassed', verdict: result.verdict }
              : { type: 'RecordValidationFailed', verdict: result.verdict },
          ),
      );

    case 'Import':
      return ports.library
        .import(effect.files, effect.target)
        .andThen((result) =>
          applyCommand(
            deps,
            acquisitionId,
            result.kind === 'imported'
              ? { type: 'RecordImported', location: result.location }
              : { type: 'RecordImportConflict', location: result.location },
          ),
        );

    case 'Cleanup':
      return ports.library.discardStaging(effect.candidate).map((): readonly StoredEvent[] => []);

    case 'AbortDownload':
      // Stop the in-flight transfer, then feed the settlement back as a failed outcome. `decide`
      // turns it into the pending candidate's rejection (staging cleanup follows via `react`); the
      // reported reason is immaterial there, so a plain `Cancelled` stands in.
      return ports.download
        .abort(acquisitionId, effect.candidate)
        .andThen(() =>
          applyCommand(deps, acquisitionId, { type: 'RecordDownloadFailed', reason: 'Cancelled' }),
        );
  }
}

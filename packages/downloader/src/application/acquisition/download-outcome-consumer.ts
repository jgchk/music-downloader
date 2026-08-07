import { errAsync, okAsync } from 'neverthrow';
import type { ResultAsync } from 'neverthrow';
import type { CandidateIdentity } from '../../domain/candidate/candidate.js';
import { infraError } from '../ports/errors.js';
import type { InfraError } from '../ports/errors.js';
import type { DownloadResult } from '../ports/outbound-ports.js';
import type { Logger } from '../logging/logger.js';
import type { CommandContext } from '../correlation/context.js';
import { applyCommand } from './command-handler.js';
import type { CommandDependencies } from './command-handler.js';
import { classifyCommandError, describeCommandError } from './failure-classification.js';

/**
 * The download-outcome consumer (nonblocking-download-observation D2): where the supervisor's
 * asynchronously-delivered outcome facts re-enter the event-sourced core — the same idiom as the
 * importer-verdict consumer. Each outcome becomes the Record* command the blocking dispatch used
 * to issue inline, carrying its candidate identity so `decide` (the single staleness guard) can
 * absorb a re-emitted outcome for a candidate the ladder already moved past. A domain rejection
 * is recorded and skipped — resolved `Ok`, because retrying it would re-fire the same rejection
 * forever; only infrastructure faults surface as `Err`, which the supervisor retries on its own
 * cadence (delivery is at-least-once; `decide` makes it exactly-once in effect).
 */
export interface DownloadOutcomeDependencies extends CommandDependencies {
  readonly logger: Logger;
}

/**
 * `context` is the one the supervisor PINNED when the watch was created, not a fresh mint: the
 * settled outcome is the same operation as the dispatch that started the download, arriving after
 * an async gap. Minting here would break the story at exactly the hop the research names as the
 * classic break point.
 */
export function deliverDownloadOutcome(
  dependencies: DownloadOutcomeDependencies,
  acquisitionId: string,
  candidate: CandidateIdentity,
  result: DownloadResult,
  context: CommandContext,
): ResultAsync<void, InfraError> {
  return applyCommand(
    dependencies,
    acquisitionId,
    result.kind === 'completed'
      ? {
          type: 'RecordDownloadCompleted',
          candidate,
          files: result.files,
        }
      : {
          type: 'RecordDownloadFailed',
          candidate,
          reason: result.reason,
          files: result.files,
        },
    context,
  )
    .map((): void => undefined)
    .orElse((error) => {
      if (classifyCommandError(error) === 'rejection') {
        dependencies.logger.warn(
          { acquisitionId, outcome: result.kind, err: error },
          'download outcome rejected as stale; recorded and skipped',
        );
        return okAsync<void, InfraError>(undefined);
      }
      return errAsync<void, InfraError>(
        error.kind === 'InfraError'
          ? error
          : infraError('download-outcome.deliver', describeCommandError(error)),
      );
    });
}

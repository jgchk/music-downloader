import { rm, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { ResultAsync } from 'neverthrow';
import type { Logger } from '../../application/logging/logger.js';
import { infraError } from '../../application/ports/errors.js';
import type { InfraError } from '../../application/ports/errors.js';
import type { IntakePort } from '../../application/ports/outbound-ports.js';

/**
 * The filesystem `IntakePort` adapter (design D5): the review queue owns intake hygiene, and this
 * is its only tool — delete a rejected release's directory and prune any parents it emptied, never
 * touching anything outside the configured intake root. An already-gone directory is fine (the
 * effect is idempotent under reactor redelivery); a path outside the root is refused loudly.
 */

/** The filesystem operations the adapter needs, as a seam so failure paths are testable. */
export interface IntakeFileSystem {
  /** Remove a directory tree, tolerating its absence. */
  removeTree(directory: string): Promise<void>;
  /** Remove a single directory only if empty (throws ENOTEMPTY otherwise). */
  removeEmptyDir(directory: string): Promise<void>;
}

export const nodeIntakeFileSystem: IntakeFileSystem = {
  removeTree: (directory) => rm(directory, { recursive: true, force: true }),
  removeEmptyDir: (directory) => rmdir(directory),
};

export interface IntakeConfig {
  readonly intakeRoot: string;
}

export class FilesystemIntake implements IntakePort {
  private readonly root: string;

  constructor(
    config: IntakeConfig,
    private readonly logger: Logger,
    private readonly fs: IntakeFileSystem = nodeIntakeFileSystem,
  ) {
    this.root = path.resolve(config.intakeRoot);
  }

  deleteRelease(directory: string): ResultAsync<void, InfraError> {
    return ResultAsync.fromPromise(this.runDelete(directory), (cause) =>
      infraError('intake.deleteRelease', String(cause), cause),
    );
  }

  private async runDelete(directory: string): Promise<void> {
    const target = path.resolve(directory);
    if (!this.isInsideRoot(target)) {
      throw new Error(`refusing to delete outside the intake root: ${target}`);
    }
    await this.fs.removeTree(target);
    this.logger.info({ directory: target }, 'deleted rejected release from intake');
    await this.pruneEmptyParents(path.dirname(target));
  }

  /** A target must be strictly inside the root — never the root itself, never a sibling. */
  private isInsideRoot(target: string): boolean {
    const relativePath = path.relative(this.root, target);
    return relativePath !== '' && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
  }

  /** Prune now-empty parents up to (never including) the intake root. */
  private async pruneEmptyParents(from: string): Promise<void> {
    for (let directory = from; this.isInsideRoot(directory); directory = path.dirname(directory)) {
      try {
        await this.fs.removeEmptyDir(directory);
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === 'ENOTEMPTY' || code === 'ENOENT') return; // still in use, or already gone
        throw error;
      }
    }
  }
}

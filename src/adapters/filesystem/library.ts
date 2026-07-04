import { access, copyFile, mkdir, rename, rm, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { ResultAsync } from 'neverthrow';
import type { CandidateIdentity } from '../../domain/candidate/candidate.js';
import type { DownloadedFile } from '../../domain/acquisition/events.js';
import type { Target } from '../../domain/target/target.js';
import { infraError } from '../../application/ports/errors.js';
import type { InfraError } from '../../application/ports/errors.js';
import type { ImportResult, LibraryPort } from '../../application/ports/outbound-ports.js';
import type { Logger } from '../../application/logging/logger.js';
import { candidateStagingDir, renderReleaseDir } from './paths.js';

/**
 * The filesystem `LibraryPort` adapter (D13). Validated staging files are organized into the
 * library by {@link renderReleaseDir}; the existing release is *never* clobbered — an occupied
 * location is a business `conflict` (an `Ok` outcome), not an infra fault. Import prefers a rename
 * and falls back to copy-then-remove across filesystems (`EXDEV`). `discardStaging` removes a
 * rejected candidate's staged files so only valid music reaches the library.
 */

/** The filesystem operations the adapter needs, as a seam so the EXDEV fallback is testable. */
export interface LibraryFileSystem {
  rename(src: string, dest: string): Promise<void>;
  copyFile(src: string, dest: string): Promise<void>;
  unlink(path: string): Promise<void>;
  mkdir(dir: string): Promise<void>;
  rm(dir: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

export const nodeLibraryFileSystem: LibraryFileSystem = {
  rename: (src, dest) => rename(src, dest),
  copyFile: (src, dest) => copyFile(src, dest),
  unlink: (path) => unlink(path),
  mkdir: (dir) => mkdir(dir, { recursive: true }).then(() => undefined),
  rm: (dir) => rm(dir, { recursive: true, force: true }),
  exists: (path) =>
    access(path).then(
      () => true,
      () => false,
    ),
};

export interface LibraryConfig {
  readonly libraryRoot: string;
  readonly stagingRoot: string;
}

export class FilesystemLibrary implements LibraryPort {
  constructor(
    private readonly config: LibraryConfig,
    private readonly logger: Logger,
    private readonly fs: LibraryFileSystem = nodeLibraryFileSystem,
  ) {}

  import(files: readonly DownloadedFile[], target: Target): ResultAsync<ImportResult, InfraError> {
    return ResultAsync.fromPromise(this.runImport(files, target), (cause) =>
      infraError('library.import', String(cause), cause),
    );
  }

  discardStaging(candidate: CandidateIdentity): ResultAsync<void, InfraError> {
    const dir = candidateStagingDir(this.config.stagingRoot, candidate);
    this.logger.debug({ dir }, 'discarding staged candidate');
    return ResultAsync.fromPromise(this.fs.rm(dir), (cause) =>
      infraError('library.discardStaging', String(cause), cause),
    );
  }

  private async runImport(files: readonly DownloadedFile[], target: Target): Promise<ImportResult> {
    const location = join(this.config.libraryRoot, renderReleaseDir(target));
    if (await this.fs.exists(location)) {
      this.logger.warn({ location }, 'library import conflict; leaving existing release untouched');
      return { kind: 'conflict', location };
    }
    await this.fs.mkdir(location);
    for (const file of files) {
      await this.moveInto(file, location);
    }
    this.logger.debug({ location, fileCount: files.length }, 'imported release');
    return { kind: 'imported', location };
  }

  private async moveInto(file: DownloadedFile, location: string): Promise<void> {
    const dest = join(location, file.name);
    try {
      await this.fs.rename(file.path, dest);
    } catch (cause) {
      if ((cause as { code?: string }).code !== 'EXDEV') throw cause;
      // Staging and library are on different filesystems: rename can't cross the boundary.
      await this.fs.copyFile(file.path, dest);
      await this.fs.unlink(file.path);
    }
  }
}

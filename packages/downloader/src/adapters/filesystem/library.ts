import { access, copyFile, mkdir, rename, rm, rmdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { ResultAsync } from 'neverthrow';
import type { DownloadedFile } from '../../domain/acquisition/events.js';
import type { Target } from '../../domain/target/target.js';
import { infraError } from '../../application/ports/errors.js';
import type { InfraError } from '../../application/ports/errors.js';
import type { ImportResult, LibraryPort } from '../../application/ports/outbound-ports.js';
import type { Logger } from '../../application/logging/logger.js';
import { renderReleaseDirectory } from './paths.js';

/**
 * The filesystem `LibraryPort` adapter (D13). Validated staging files are organized into the
 * library by {@link renderReleaseDirectory}; the existing release is *never* clobbered — an occupied
 * location is a business `conflict` (an `Ok` outcome), not an infra fault. Import prefers a rename
 * and falls back to copy-then-remove across filesystems (`EXDEV`). `discardStaging` removes exactly
 * the staged files it is handed (the source-reported locations carried on the cleanup event, D3)
 * and prunes their emptied directory — never an identity-recomputed path, never an `rm -rf` of a
 * folder slskd may share between candidates.
 */

/** The filesystem operations the adapter needs, as a seam so the EXDEV fallback is testable. */
export interface LibraryFileSystem {
  rename(source: string, destination: string): Promise<void>;
  copyFile(source: string, destination: string): Promise<void>;
  unlink(path: string): Promise<void>;
  mkdir(directory: string): Promise<void>;
  /** Remove a single file, tolerating its absence (it may already have been moved by import). */
  rmFile(path: string): Promise<void>;
  /** Remove a directory only if empty (used to prune a candidate's emptied staging folder). */
  rmdir(directory: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

export const nodeLibraryFileSystem: LibraryFileSystem = {
  rename: (source, destination) => rename(source, destination),
  copyFile: (source, destination) => copyFile(source, destination),
  unlink: (path) => unlink(path),
  mkdir: async (directory) => {
    await mkdir(directory, { recursive: true });
  },
  rmFile: (path) => rm(path, { force: true }),
  rmdir: (directory) => rmdir(directory),
  exists: async (path) => {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  },
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

  discardStaging(files: readonly DownloadedFile[]): ResultAsync<void, InfraError> {
    this.logger.debug({ fileCount: files.length }, 'discarding staged files');
    return ResultAsync.fromPromise(this.runDiscard(files), (cause) =>
      infraError('library.discardStaging', String(cause), cause),
    );
  }

  private async runDiscard(files: readonly DownloadedFile[]): Promise<void> {
    const directories = new Set(files.map((file) => path.dirname(file.path)));
    for (const file of files) await this.fs.rmFile(file.path);
    for (const directory of directories) await this.pruneIfEmpty(directory);
  }

  /**
   * Prune the candidate's now-emptied staging directory. A directory slskd disambiguated between
   * candidates (still holding another's files) stays, and one already gone is fine — both are
   * expected, so only an unexpected fault propagates.
   */
  private async pruneIfEmpty(directory: string): Promise<void> {
    try {
      await this.fs.rmdir(directory);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== 'ENOTEMPTY' && code !== 'ENOENT') throw error;
    }
  }

  private async runImport(files: readonly DownloadedFile[], target: Target): Promise<ImportResult> {
    const location = path.join(this.config.libraryRoot, renderReleaseDirectory(target));
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
    const destination = path.join(location, file.name);
    try {
      await this.fs.rename(file.path, destination);
    } catch (error) {
      if ((error as { code?: string }).code !== 'EXDEV') throw error;
      // Staging and library are on different filesystems: rename can't cross the boundary.
      await this.fs.copyFile(file.path, destination);
      await this.fs.unlink(file.path);
    }
  }
}

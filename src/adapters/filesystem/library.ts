import { access, copyFile, mkdir, rename, rm, rmdir, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { ResultAsync } from 'neverthrow';
import type { DownloadedFile } from '../../domain/acquisition/events.js';
import type { Target } from '../../domain/target/target.js';
import { infraError } from '../../application/ports/errors.js';
import type { InfraError } from '../../application/ports/errors.js';
import type { ImportResult, LibraryPort } from '../../application/ports/outbound-ports.js';
import type { Logger } from '../../application/logging/logger.js';
import { renderReleaseDir } from './paths.js';

/**
 * The filesystem `LibraryPort` adapter (D13). Validated staging files are organized into the
 * library by {@link renderReleaseDir}; the existing release is *never* clobbered — an occupied
 * location is a business `conflict` (an `Ok` outcome), not an infra fault. Import prefers a rename
 * and falls back to copy-then-remove across filesystems (`EXDEV`). `discardStaging` removes exactly
 * the staged files it is handed (the source-reported locations carried on the cleanup event, D3)
 * and prunes their emptied directory — never an identity-recomputed path, never an `rm -rf` of a
 * folder slskd may share between candidates.
 */

/** The filesystem operations the adapter needs, as a seam so the EXDEV fallback is testable. */
export interface LibraryFileSystem {
  rename(src: string, dest: string): Promise<void>;
  copyFile(src: string, dest: string): Promise<void>;
  unlink(path: string): Promise<void>;
  mkdir(dir: string): Promise<void>;
  /** Remove a single file, tolerating its absence (it may already have been moved by import). */
  rmFile(path: string): Promise<void>;
  /** Remove a directory only if empty (used to prune a candidate's emptied staging folder). */
  rmdir(dir: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

export const nodeLibraryFileSystem: LibraryFileSystem = {
  rename: (src, dest) => rename(src, dest),
  copyFile: (src, dest) => copyFile(src, dest),
  unlink: (path) => unlink(path),
  mkdir: (dir) => mkdir(dir, { recursive: true }).then(() => undefined),
  rmFile: (path) => rm(path, { force: true }),
  rmdir: (dir) => rmdir(dir),
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

  discardStaging(files: readonly DownloadedFile[]): ResultAsync<void, InfraError> {
    this.logger.debug({ fileCount: files.length }, 'discarding staged files');
    return ResultAsync.fromPromise(this.runDiscard(files), (cause) =>
      infraError('library.discardStaging', String(cause), cause),
    );
  }

  private async runDiscard(files: readonly DownloadedFile[]): Promise<void> {
    const dirs = new Set(files.map((file) => dirname(file.path)));
    for (const file of files) await this.fs.rmFile(file.path);
    for (const dir of dirs) await this.pruneIfEmpty(dir);
  }

  /**
   * Prune the candidate's now-emptied staging directory. A directory slskd disambiguated between
   * candidates (still holding another's files) stays, and one already gone is fine — both are
   * expected, so only an unexpected fault propagates.
   */
  private async pruneIfEmpty(dir: string): Promise<void> {
    try {
      await this.fs.rmdir(dir);
    } catch (cause) {
      const code = (cause as { code?: string }).code;
      if (code !== 'ENOTEMPTY' && code !== 'ENOENT') throw cause;
    }
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

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { testScope } from '../../application/__fixtures__/correlation.js';
import type { DownloadedFile } from '../../domain/download/events.js';
import { createTarget } from '../../domain/target/target.js';
import type { Target } from '../../domain/target/target.js';
import { FilesystemLibrary, nodeLibraryFileSystem } from './library.js';
import type { LibraryConfig, LibraryFileSystem } from './library.js';

const TARGET: Target = createTarget({
  type: 'album',
  artist: 'The Band',
  title: 'Great Album',
  tracks: [{ position: 1, title: 'One', durationMs: 1000 }],
  year: 2020,
})._unsafeUnwrap();

const roots: string[] = [];

async function workspace(): Promise<
  LibraryConfig & { stage: (name: string) => Promise<DownloadedFile> }
> {
  const root = await mkdtemp(path.join(tmpdir(), 'md-lib-'));
  roots.push(root);
  const stagingRoot = path.join(root, 'staging');
  const libraryRoot = path.join(root, 'library');
  await mkdir(stagingRoot, { recursive: true });
  return {
    libraryRoot,
    stagingRoot,
    stage: async (name) => {
      const filePath = path.join(stagingRoot, name);
      await writeFile(filePath, `contents-of-${name}`);
      return { path: filePath, name };
    },
  };
}

afterEach(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
  roots.length = 0;
});

describe('FilesystemLibrary.import', () => {
  it('organizes validated files into the policy path and clears staging', async () => {
    const ws = await workspace();
    const files = [await ws.stage('01.flac'), await ws.stage('02.flac')];
    const library = new FilesystemLibrary(ws);

    const importResult = await library.import(files, TARGET, testScope());
    const result = importResult._unsafeUnwrap();

    const expected = path.join(ws.libraryRoot, 'The_Band', 'Great_Album_(2020)');
    expect(result).toEqual({ kind: 'imported', location: expected });
    expect(await readFile(path.join(expected, '01.flac'), 'utf8')).toBe('contents-of-01.flac');
    expect(existsSync(files[0]!.path)).toBe(false);
  });

  it('reports a conflict without clobbering an existing release', async () => {
    const ws = await workspace();
    const location = path.join(ws.libraryRoot, 'The_Band', 'Great_Album_(2020)');
    await mkdir(location, { recursive: true });
    await writeFile(path.join(location, 'existing.flac'), 'original');
    const file = await ws.stage('01.flac');
    const library = new FilesystemLibrary(ws);

    const importResult2 = await library.import([file], TARGET, testScope());
    const result = importResult2._unsafeUnwrap();

    expect(result).toEqual({ kind: 'conflict', location });
    expect(await readFile(path.join(location, 'existing.flac'), 'utf8')).toBe('original');
    expect(existsSync(file.path)).toBe(true); // staging left intact for the conflict
  });

  it('falls back to copy-then-remove across filesystems (EXDEV)', async () => {
    const ws = await workspace();
    const file = await ws.stage('01.flac');
    const exdevFs: LibraryFileSystem = {
      ...nodeLibraryFileSystem,
      rename: () =>
        Promise.reject(Object.assign(new Error('cross-device link'), { code: 'EXDEV' })),
    };
    const library = new FilesystemLibrary(ws, exdevFs);

    const importResult3 = await library.import([file], TARGET, testScope());
    const result = importResult3._unsafeUnwrap();

    const expected = path.join(ws.libraryRoot, 'The_Band', 'Great_Album_(2020)');
    expect(result).toEqual({ kind: 'imported', location: expected });
    expect(await readFile(path.join(expected, '01.flac'), 'utf8')).toBe('contents-of-01.flac');
    expect(existsSync(file.path)).toBe(false);
  });

  it('reserves the copy fallback for EXDEV: another rename fault is surfaced, not worked around', async () => {
    // The fallback exists because rename cannot cross a filesystem boundary — nothing else. A
    // rename refused for any other reason (here: permissions) must reach the caller as a fault
    // even though copy-then-remove would have "worked", or a misconfigured library silently
    // reports every release as imported.
    const ws = await workspace();
    const file = await ws.stage('01.flac');
    const deniedFs: LibraryFileSystem = {
      ...nodeLibraryFileSystem,
      rename: () => Promise.reject(Object.assign(new Error('denied'), { code: 'EACCES' })),
    };
    const library = new FilesystemLibrary(ws, deniedFs);

    const result = await library.import([file], TARGET, testScope());

    expect(result._unsafeUnwrapErr()).toMatchObject({
      kind: 'InfraError',
      operation: 'library.import',
    });
    expect(existsSync(file.path)).toBe(true); // the staged file was never copied away
  });

  it('surfaces a non-EXDEV filesystem fault as an InfraError', async () => {
    const ws = await workspace();
    const missing: DownloadedFile = {
      path: path.join(ws.stagingRoot, 'missing.flac'),
      name: 'missing.flac',
    };
    const library = new FilesystemLibrary(ws);

    const result = await library.import([missing], TARGET, testScope());

    expect(result._unsafeUnwrapErr()).toMatchObject({
      kind: 'InfraError',
      operation: 'library.import',
    });
  });
});

describe('nodeLibraryFileSystem', () => {
  it('answers whether a path is there, reporting an unreachable one as absent', async () => {
    // `exists` is the seam the import conflict check turns on, and its contract is a boolean
    // answer: an unreachable path is an absence, never a raised fault the caller has to catch.
    const ws = await workspace();

    expect(await nodeLibraryFileSystem.exists(ws.stagingRoot)).toBe(true);
    expect(await nodeLibraryFileSystem.exists(path.join(ws.stagingRoot, 'never-written'))).toBe(
      false,
    );
  });
});

describe('FilesystemLibrary.discardStaging', () => {
  /** Stage `names` inside a leaf staging folder, returning them as the download reported them. */
  async function stageLeaf(
    stagingRoot: string,
    names: readonly string[],
  ): Promise<DownloadedFile[]> {
    const leaf = path.join(stagingRoot, 'Some Album');
    await mkdir(leaf, { recursive: true });
    const files: DownloadedFile[] = [];
    for (const name of names) {
      const filePath = path.join(leaf, name);
      await writeFile(filePath, `staged-${name}`);
      files.push({ path: filePath, name });
    }
    return files;
  }

  it('removes exactly the given files and prunes their emptied directory', async () => {
    const ws = await workspace();
    const files = await stageLeaf(ws.stagingRoot, ['01.flac', '02.flac']);
    const library = new FilesystemLibrary(ws);

    const discardStagingResult = await library.discardStaging(files, testScope());
    discardStagingResult._unsafeUnwrap();

    expect(existsSync(files[0]!.path)).toBe(false);
    expect(existsSync(path.join(ws.stagingRoot, 'Some Album'))).toBe(false);
  });

  it('removes only the given files, leaving a directory slskd shares between candidates', async () => {
    const ws = await workspace();
    const [ours] = await stageLeaf(ws.stagingRoot, ['01.flac']);
    const others = path.join(ws.stagingRoot, 'Some Album', 'another.flac');
    await writeFile(others, 'not ours');
    const library = new FilesystemLibrary(ws);

    const discardStagingResult2 = await library.discardStaging([ours!], testScope());
    discardStagingResult2._unsafeUnwrap();

    expect(existsSync(ours!.path)).toBe(false);
    expect(existsSync(others)).toBe(true); // the shared leaf folder is left in place
  });

  it('tolerates files already moved out by a successful import, still pruning the folder', async () => {
    const ws = await workspace();
    const leaf = path.join(ws.stagingRoot, 'Some Album');
    await mkdir(leaf, { recursive: true }); // emptied by import — the files no longer exist
    const files: DownloadedFile[] = [{ path: path.join(leaf, '01.flac'), name: '01.flac' }];
    const library = new FilesystemLibrary(ws);

    const discardStagingResult3 = await library.discardStaging(files, testScope());
    discardStagingResult3._unsafeUnwrap();

    expect(existsSync(leaf)).toBe(false);
  });

  it('is a no-op when nothing was staged (files and folder already gone)', async () => {
    const ws = await workspace();
    const files: DownloadedFile[] = [
      { path: path.join(ws.stagingRoot, 'Gone', '01.flac'), name: '01.flac' },
    ];
    const library = new FilesystemLibrary(ws);

    const discardStagingResult4 = await library.discardStaging(files, testScope());
    expect(discardStagingResult4.isOk()).toBe(true);
  });

  it('surfaces an unexpected file-removal fault as an InfraError', async () => {
    const ws = await workspace();
    const failing: LibraryFileSystem = {
      ...nodeLibraryFileSystem,
      rmFile: () => Promise.reject(new Error('permission denied')),
    };
    const library = new FilesystemLibrary(ws, failing);

    const result = await library.discardStaging(
      [{ path: path.join(ws.stagingRoot, 'x', '01.flac'), name: '01.flac' }],
      testScope(),
    );

    expect(result._unsafeUnwrapErr()).toMatchObject({
      kind: 'InfraError',
      operation: 'library.discardStaging',
    });
  });

  it('surfaces an unexpected directory-prune fault as an InfraError', async () => {
    const ws = await workspace();
    const files = await stageLeaf(ws.stagingRoot, ['01.flac']);
    const failing: LibraryFileSystem = {
      ...nodeLibraryFileSystem,
      rmdir: () => Promise.reject(Object.assign(new Error('denied'), { code: 'EACCES' })),
    };
    const library = new FilesystemLibrary(ws, failing);

    const result = await library.discardStaging(files, testScope());

    expect(result._unsafeUnwrapErr()).toMatchObject({
      kind: 'InfraError',
      operation: 'library.discardStaging',
    });
  });
});

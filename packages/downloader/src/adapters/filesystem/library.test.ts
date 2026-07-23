import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { silentLogger } from '../../application/__fixtures__/fakes.js';
import type { DownloadedFile } from '../../domain/acquisition/events.js';
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
    const library = new FilesystemLibrary(ws, silentLogger());

    const importResult = await library.import(files, TARGET);
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
    const library = new FilesystemLibrary(ws, silentLogger());

    const importResult2 = await library.import([file], TARGET);
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
    const library = new FilesystemLibrary(ws, silentLogger(), exdevFs);

    const importResult3 = await library.import([file], TARGET);
    const result = importResult3._unsafeUnwrap();

    const expected = path.join(ws.libraryRoot, 'The_Band', 'Great_Album_(2020)');
    expect(result).toEqual({ kind: 'imported', location: expected });
    expect(await readFile(path.join(expected, '01.flac'), 'utf8')).toBe('contents-of-01.flac');
    expect(existsSync(file.path)).toBe(false);
  });

  it('surfaces a non-EXDEV filesystem fault as an InfraError', async () => {
    const ws = await workspace();
    const missing: DownloadedFile = {
      path: path.join(ws.stagingRoot, 'missing.flac'),
      name: 'missing.flac',
    };
    const library = new FilesystemLibrary(ws, silentLogger());

    const result = await library.import([missing], TARGET);

    expect(result._unsafeUnwrapErr()).toMatchObject({
      kind: 'InfraError',
      operation: 'library.import',
    });
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
    const library = new FilesystemLibrary(ws, silentLogger());

    const discardStagingResult = await library.discardStaging(files);
    discardStagingResult._unsafeUnwrap();

    expect(existsSync(files[0]!.path)).toBe(false);
    expect(existsSync(path.join(ws.stagingRoot, 'Some Album'))).toBe(false);
  });

  it('removes only the given files, leaving a directory slskd shares between candidates', async () => {
    const ws = await workspace();
    const [ours] = await stageLeaf(ws.stagingRoot, ['01.flac']);
    const others = path.join(ws.stagingRoot, 'Some Album', 'another.flac');
    await writeFile(others, 'not ours');
    const library = new FilesystemLibrary(ws, silentLogger());

    const discardStagingResult2 = await library.discardStaging([ours!]);
    discardStagingResult2._unsafeUnwrap();

    expect(existsSync(ours!.path)).toBe(false);
    expect(existsSync(others)).toBe(true); // the shared leaf folder is left in place
  });

  it('tolerates files already moved out by a successful import, still pruning the folder', async () => {
    const ws = await workspace();
    const leaf = path.join(ws.stagingRoot, 'Some Album');
    await mkdir(leaf, { recursive: true }); // emptied by import — the files no longer exist
    const files: DownloadedFile[] = [{ path: path.join(leaf, '01.flac'), name: '01.flac' }];
    const library = new FilesystemLibrary(ws, silentLogger());

    const discardStagingResult3 = await library.discardStaging(files);
    discardStagingResult3._unsafeUnwrap();

    expect(existsSync(leaf)).toBe(false);
  });

  it('is a no-op when nothing was staged (files and folder already gone)', async () => {
    const ws = await workspace();
    const files: DownloadedFile[] = [
      { path: path.join(ws.stagingRoot, 'Gone', '01.flac'), name: '01.flac' },
    ];
    const library = new FilesystemLibrary(ws, silentLogger());

    const discardStagingResult4 = await library.discardStaging(files);
    expect(discardStagingResult4.isOk()).toBe(true);
  });

  it('surfaces an unexpected file-removal fault as an InfraError', async () => {
    const ws = await workspace();
    const failing: LibraryFileSystem = {
      ...nodeLibraryFileSystem,
      rmFile: () => Promise.reject(new Error('permission denied')),
    };
    const library = new FilesystemLibrary(ws, silentLogger(), failing);

    const result = await library.discardStaging([
      { path: path.join(ws.stagingRoot, 'x', '01.flac'), name: '01.flac' },
    ]);

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
    const library = new FilesystemLibrary(ws, silentLogger(), failing);

    const result = await library.discardStaging(files);

    expect(result._unsafeUnwrapErr()).toMatchObject({
      kind: 'InfraError',
      operation: 'library.discardStaging',
    });
  });
});

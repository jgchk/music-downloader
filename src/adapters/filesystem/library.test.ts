import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { silentLogger } from '../../application/__fixtures__/fakes.js';
import type { DownloadedFile } from '../../domain/acquisition/events.js';
import type { Target } from '../../domain/target/target.js';
import { FilesystemLibrary, nodeLibraryFileSystem } from './library.js';
import type { LibraryConfig, LibraryFileSystem } from './library.js';
import { candidateStagingDir } from './paths.js';

const TARGET: Target = {
  type: 'album',
  artist: 'The Band',
  title: 'Great Album',
  tracks: [{ position: 1, title: 'One', durationMs: 1000 }],
  year: 2020,
};

const roots: string[] = [];

async function workspace(): Promise<
  LibraryConfig & { stage: (name: string) => Promise<DownloadedFile> }
> {
  const root = await mkdtemp(join(tmpdir(), 'md-lib-'));
  roots.push(root);
  const stagingRoot = join(root, 'staging');
  const libraryRoot = join(root, 'library');
  await mkdir(stagingRoot, { recursive: true });
  return {
    libraryRoot,
    stagingRoot,
    stage: async (name) => {
      const path = join(stagingRoot, name);
      await writeFile(path, `contents-of-${name}`);
      return { path, name };
    },
  };
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('FilesystemLibrary.import', () => {
  it('organizes validated files into the policy path and clears staging', async () => {
    const ws = await workspace();
    const files = [await ws.stage('01.flac'), await ws.stage('02.flac')];
    const lib = new FilesystemLibrary(ws, silentLogger());

    const result = (await lib.import(files, TARGET))._unsafeUnwrap();

    const expected = join(ws.libraryRoot, 'The_Band', 'Great_Album_(2020)');
    expect(result).toEqual({ kind: 'imported', location: expected });
    expect(await readFile(join(expected, '01.flac'), 'utf8')).toBe('contents-of-01.flac');
    expect(existsSync(files[0]!.path)).toBe(false);
  });

  it('reports a conflict without clobbering an existing release', async () => {
    const ws = await workspace();
    const location = join(ws.libraryRoot, 'The_Band', 'Great_Album_(2020)');
    await mkdir(location, { recursive: true });
    await writeFile(join(location, 'existing.flac'), 'original');
    const file = await ws.stage('01.flac');
    const lib = new FilesystemLibrary(ws, silentLogger());

    const result = (await lib.import([file], TARGET))._unsafeUnwrap();

    expect(result).toEqual({ kind: 'conflict', location });
    expect(await readFile(join(location, 'existing.flac'), 'utf8')).toBe('original');
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
    const lib = new FilesystemLibrary(ws, silentLogger(), exdevFs);

    const result = (await lib.import([file], TARGET))._unsafeUnwrap();

    const expected = join(ws.libraryRoot, 'The_Band', 'Great_Album_(2020)');
    expect(result).toEqual({ kind: 'imported', location: expected });
    expect(await readFile(join(expected, '01.flac'), 'utf8')).toBe('contents-of-01.flac');
    expect(existsSync(file.path)).toBe(false);
  });

  it('surfaces a non-EXDEV filesystem fault as an InfraError', async () => {
    const ws = await workspace();
    const missing: DownloadedFile = {
      path: join(ws.stagingRoot, 'missing.flac'),
      name: 'missing.flac',
    };
    const lib = new FilesystemLibrary(ws, silentLogger());

    const result = await lib.import([missing], TARGET);

    expect(result._unsafeUnwrapErr()).toMatchObject({
      kind: 'InfraError',
      operation: 'library.import',
    });
  });
});

describe('FilesystemLibrary.discardStaging', () => {
  const identity = { username: 'peer', path: '/music/album', sizeBytes: 42 };

  it('removes a rejected candidate’s staged files', async () => {
    const ws = await workspace();
    const dir = candidateStagingDir(ws.stagingRoot, identity);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'junk.flac'), 'partial');
    const lib = new FilesystemLibrary(ws, silentLogger());

    (await lib.discardStaging(identity))._unsafeUnwrap();

    expect(existsSync(dir)).toBe(false);
  });

  it('is a no-op when nothing was staged', async () => {
    const ws = await workspace();
    const lib = new FilesystemLibrary(ws, silentLogger());

    const result = await lib.discardStaging(identity);

    expect(result.isOk()).toBe(true);
  });

  it('surfaces a filesystem fault as an InfraError', async () => {
    const ws = await workspace();
    const failing: LibraryFileSystem = {
      ...nodeLibraryFileSystem,
      rm: () => Promise.reject(new Error('permission denied')),
    };
    const lib = new FilesystemLibrary(ws, silentLogger(), failing);

    const result = await lib.discardStaging(identity);

    expect(result._unsafeUnwrapErr()).toMatchObject({
      kind: 'InfraError',
      operation: 'library.discardStaging',
    });
  });
});

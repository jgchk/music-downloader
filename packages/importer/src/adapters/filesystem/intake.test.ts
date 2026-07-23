import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { silentLogger } from '../../application/__fixtures__/fakes.js';
import { FilesystemIntake } from './intake.js';
import type { IntakeFileSystem } from './intake.js';

const temporaryDirectories: string[] = [];

function freshRoot(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'mi-intake-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories) rmSync(directory, { recursive: true, force: true });
  temporaryDirectories.length = 0;
});

describe('FilesystemIntake', () => {
  it('deletes a release directory and prunes its emptied parents up to the root', async () => {
    const root = freshRoot();
    const release = path.join(root, 'batch-7', 'Artist - Album');
    mkdirSync(release, { recursive: true });
    writeFileSync(path.join(release, '01.mp3'), 'x');

    const intake = new FilesystemIntake({ intakeRoot: root }, silentLogger());
    const releaseDeletionResult = await intake.deleteRelease(release);
    releaseDeletionResult._unsafeUnwrap();

    expect(existsSync(release)).toBe(false);
    expect(existsSync(path.join(root, 'batch-7'))).toBe(false); // emptied parent pruned
    expect(existsSync(root)).toBe(true); // never the root itself
  });

  it('leaves a parent holding other releases untouched', async () => {
    const root = freshRoot();
    const release = path.join(root, 'batch-7', 'Artist - Album');
    const sibling = path.join(root, 'batch-7', 'Other - Album');
    mkdirSync(release, { recursive: true });
    mkdirSync(sibling, { recursive: true });

    const intake = new FilesystemIntake({ intakeRoot: root }, silentLogger());
    const releaseDeletionResult2 = await intake.deleteRelease(release);
    releaseDeletionResult2._unsafeUnwrap();

    expect(existsSync(release)).toBe(false);
    expect(existsSync(sibling)).toBe(true);
  });

  it('tolerates an already-gone directory (idempotent under redelivery)', async () => {
    const root = freshRoot();
    const intake = new FilesystemIntake({ intakeRoot: root }, silentLogger());
    const result = await intake.deleteRelease(path.join(root, 'never-existed'));
    expect(result.isOk()).toBe(true);
  });

  it('refuses to delete outside the intake root', async () => {
    const root = freshRoot();
    const outside = freshRoot();
    const intake = new FilesystemIntake({ intakeRoot: root }, silentLogger());

    const result = await intake.deleteRelease(path.join(outside, 'album'));
    expect(result._unsafeUnwrapErr()).toMatchObject({ kind: 'InfraError' });
    expect(result._unsafeUnwrapErr().message).toContain('refusing to delete');
  });

  it('refuses to delete the intake root itself', async () => {
    const root = freshRoot();
    const intake = new FilesystemIntake({ intakeRoot: root }, silentLogger());
    const result = await intake.deleteRelease(root);
    expect(result.isErr()).toBe(true);
    expect(existsSync(root)).toBe(true);
  });

  it('refuses a sneaky traversal that resolves outside the root', async () => {
    const root = freshRoot();
    const intake = new FilesystemIntake({ intakeRoot: root }, silentLogger());
    const result = await intake.deleteRelease(path.join(root, '..', 'sibling'));
    expect(result.isErr()).toBe(true);
  });

  it('surfaces an unexpected pruning fault as an InfraError', async () => {
    const root = freshRoot();
    const release = path.join(root, 'batch', 'album');
    const failing: IntakeFileSystem = {
      removeTree: () => Promise.resolve(),
      removeEmptyDir: () => Promise.reject(Object.assign(new Error('EACCES'), { code: 'EACCES' })),
    };
    const intake = new FilesystemIntake({ intakeRoot: root }, silentLogger(), failing);
    const result = await intake.deleteRelease(release);
    expect(result._unsafeUnwrapErr()).toMatchObject({ kind: 'InfraError' });
  });

  it('stops pruning quietly when a parent vanished concurrently', async () => {
    const root = freshRoot();
    const release = path.join(root, 'batch', 'album');
    const gone: IntakeFileSystem = {
      removeTree: () => Promise.resolve(),
      removeEmptyDir: () => Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
    };
    const intake = new FilesystemIntake({ intakeRoot: root }, silentLogger(), gone);
    const result = await intake.deleteRelease(release);
    expect(result.isOk()).toBe(true);
  });
});

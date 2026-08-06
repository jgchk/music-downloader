import { describe, expect, it } from 'vitest';
import { isGitPathAbsent, isJjPathAbsent, parseCommitLog } from './reader.ts';

/**
 * `parseCommitLog` turns a `<hash>\x1f<message>\x00`-delimited log (emitted identically by the git
 * and jj backends) into range commits. The behaviour that matters — and the one the git path never
 * exercised — is dropping description-less commits: jj routinely carries empty commits (the working
 * copy, abandoned-then-recreated commits) that appear in a `tag..@` range as a hash with no message.
 * Left in, they crash the conventional-commits parser ("Expected a raw commit"); they must be
 * dropped, matching the old git-path `filter(m => m.length > 0)`.
 */
describe('parseCommitLog', () => {
  it('parses a commit into its full hash and trimmed message', () => {
    expect(parseCommitLog('abc123\u{1F}feat(web): add health endpoint\n\u{0}')).toEqual([
      { hash: 'abc123', message: 'feat(web): add health endpoint' },
    ]);
  });

  it('preserves a multi-line message body', () => {
    const log = 'abc123\u{1F}fix(x): repair\n\nBREAKING CHANGE: it moved\n\u{0}';
    expect(parseCommitLog(log)[0]?.message).toBe('fix(x): repair\n\nBREAKING CHANGE: it moved');
  });

  it('drops a description-less commit (jj empty commit) so the parser never sees it', () => {
    const log = 'aaa\u{1F}feat: real\u{0}bbb\u{1F}\u{0}ccc\u{1F}fix: also real\u{0}';
    expect(parseCommitLog(log)).toEqual([
      { hash: 'aaa', message: 'feat: real' },
      { hash: 'ccc', message: 'fix: also real' },
    ]);
  });

  it('returns nothing for an empty log', () => {
    expect(parseCommitLog('')).toEqual([]);
  });
});

/**
 * Reading a file out of a revision fails for two very different reasons, and both exit non-zero:
 * the file is simply not in that revision (→ `''`, which the caller reassembles CHANGELOG.md
 * around), or the read itself failed — an unresolvable revision, a revset function this jj version
 * does not have, an unusable repository. Conflating them is data loss: an empty base CHANGELOG.md
 * makes `version:prep` rewrite the file with the whole release history dropped, and report success.
 * These predicates are the discriminator, pinned against the tools' real stderr.
 */
describe('isGitPathAbsent', () => {
  it('is absent when the path is not in that revision', () => {
    expect(isGitPathAbsent("fatal: path 'CHANGELOG.md' does not exist in 'HEAD'\n")).toBe(true);
  });

  it('is absent when the path is on disk but untracked in that revision', () => {
    expect(
      isGitPathAbsent("fatal: path 'CHANGELOG.md' exists on disk, but not in 'a1b2c3d'\n"),
    ).toBe(true);
  });

  it('is NOT absent when the revision itself does not resolve', () => {
    expect(isGitPathAbsent("fatal: invalid object name 'origin/main'.\n")).toBe(false);
  });

  it('is NOT absent when the repository is unusable', () => {
    expect(
      isGitPathAbsent(
        'fatal: not a git repository (or any parent up to mount point /)\nStopping at filesystem boundary.\n',
      ),
    ).toBe(false);
  });
});

describe('isJjPathAbsent', () => {
  it('is absent when the path is not in that revision', () => {
    expect(isJjPathAbsent('Error: No such path: CHANGELOG.md\n')).toBe(true);
  });

  it('is NOT absent when the revset function is missing from this jj version', () => {
    // The version-gated `fork_point()` the base revision is read through — the same "a dependency
    // moved under us" failure the preset guard exists for, one binary over.
    expect(
      isJjPathAbsent("Error: Failed to parse revset: Function `fork_point` doesn't exist\n"),
    ).toBe(false);
  });

  it('is NOT absent when the revision does not resolve (no `main@origin` bookmark)', () => {
    expect(isJjPathAbsent("Error: Revision `main@origin` doesn't exist\n")).toBe(false);
  });
});

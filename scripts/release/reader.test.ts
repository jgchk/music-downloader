import { describe, expect, it } from 'vitest';
import { parseCommitLog } from './reader.ts';

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
    expect(parseCommitLog('abc123\x1ffeat(web): add health endpoint\n\x00')).toEqual([
      { hash: 'abc123', message: 'feat(web): add health endpoint' },
    ]);
  });

  it('preserves a multi-line message body', () => {
    const log = 'abc123\x1ffix(x): repair\n\nBREAKING CHANGE: it moved\n\x00';
    expect(parseCommitLog(log)[0]?.message).toBe('fix(x): repair\n\nBREAKING CHANGE: it moved');
  });

  it('drops a description-less commit (jj empty commit) so the parser never sees it', () => {
    const log = 'aaa\x1ffeat: real\x00bbb\x1f\x00ccc\x1ffix: also real\x00';
    expect(parseCommitLog(log)).toEqual([
      { hash: 'aaa', message: 'feat: real' },
      { hash: 'ccc', message: 'fix: also real' },
    ]);
  });

  it('returns nothing for an empty log', () => {
    expect(parseCommitLog('')).toEqual([]);
  });
});

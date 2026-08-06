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

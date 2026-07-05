import { describe, expect, it } from 'vitest';
import { hasReleasableCommits } from './bump.ts';

/**
 * The releasable-commit guard restores semantic-release's "no release for chore-only ranges"
 * semantics that commit-and-tag-version drops (it would patch-bump anything). A range is releasable
 * iff it contains a `feat`, `fix`, or `perf`, or any breaking marker (`type!:` or a `BREAKING
 * CHANGE:` footer).
 */
describe('hasReleasableCommits', () => {
  it('is releasable for a feat', () => {
    expect(hasReleasableCommits(['feat(mcp): add streamable transport'])).toBe(true);
  });

  it('is releasable for a fix', () => {
    expect(hasReleasableCommits(['fix(slskd): parse per-user downloads'])).toBe(true);
  });

  it('is releasable for a perf', () => {
    expect(hasReleasableCommits(['perf(reactor): batch projection writes'])).toBe(true);
  });

  it('is releasable for a bare feat without scope', () => {
    expect(hasReleasableCommits(['feat: add thing'])).toBe(true);
  });

  it('is not releasable for chore / docs / test / refactor / build / ci / style only', () => {
    expect(
      hasReleasableCommits([
        'chore(deps): bump vitest',
        'docs(readme): tidy wording',
        'test(contract): add fixture',
        'refactor(domain): extract decider',
        'build(docker): slim image',
        'ci(release): tweak workflow',
        'style: reformat',
      ]),
    ).toBe(false);
  });

  it('is releasable for a breaking change marked with ! after the type', () => {
    expect(hasReleasableCommits(['refactor!: drop stdio transport'])).toBe(true);
  });

  it('is releasable for a breaking change marked with ! after a scope', () => {
    expect(hasReleasableCommits(['chore(api)!: remove deprecated field'])).toBe(true);
  });

  it('is releasable for a BREAKING CHANGE footer even on a non-releasable type', () => {
    expect(
      hasReleasableCommits(['refactor(core): rework wiring\n\nBREAKING CHANGE: ports moved']),
    ).toBe(true);
  });

  it('ignores the chore(release) bump commit itself', () => {
    expect(hasReleasableCommits(['chore(release): 2.1.0'])).toBe(false);
  });

  it('is releasable when any commit in a mixed range qualifies', () => {
    expect(
      hasReleasableCommits(['docs: tidy', 'chore(release): 2.0.0', 'fix(http): 404 mapping']),
    ).toBe(true);
  });

  it('is not releasable for an empty range', () => {
    expect(hasReleasableCommits([])).toBe(false);
  });

  it('does not treat a type merely containing "feat" as a feat', () => {
    expect(hasReleasableCommits(['feature: not a conventional type'])).toBe(false);
  });
});

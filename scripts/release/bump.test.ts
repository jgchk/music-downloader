import { describe, expect, it } from 'vitest';
import { applyBump, bumpLevel, hasReleasableCommits } from './bump.ts';

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

/**
 * The level catv would have chosen from the same headers: breaking → major, feat → minor,
 * fix/perf → patch, nothing → null. perf still bumps a patch (though its section is hidden), and the
 * highest level across a mixed range wins.
 */
describe('bumpLevel', () => {
  it('is null for a chore/docs-only range', () => {
    expect(bumpLevel(['chore(deps): bump vitest', 'docs: tidy'])).toBe(null);
  });

  it('is patch for a fix', () => {
    expect(bumpLevel(['fix(slskd): parse per-user downloads'])).toBe('patch');
  });

  it('is patch for a perf (bumps even though its section is hidden)', () => {
    expect(bumpLevel(['perf(reactor): batch projection writes'])).toBe('patch');
  });

  it('is minor for a feat', () => {
    expect(bumpLevel(['feat(mcp): add streamable transport'])).toBe('minor');
  });

  it('is major for a ! breaking marker', () => {
    expect(bumpLevel(['refactor!: drop stdio transport'])).toBe('major');
  });

  it('is major for a BREAKING CHANGE footer on a non-releasable type', () => {
    expect(bumpLevel(['refactor(core): rework wiring\n\nBREAKING CHANGE: ports moved'])).toBe(
      'major',
    );
  });

  it('is major for a feat that also carries a breaking footer', () => {
    expect(bumpLevel(['feat(api): new field\n\nBREAKING CHANGE: old field removed'])).toBe('major');
  });

  it('takes the highest level across a mixed range', () => {
    expect(bumpLevel(['fix: a', 'feat: b', 'docs: c'])).toBe('minor');
    expect(bumpLevel(['fix: a', 'chore(api)!: drop field'])).toBe('major');
  });

  it('is null for an empty range', () => {
    expect(bumpLevel([])).toBe(null);
  });
});

describe('applyBump', () => {
  it('bumps major and resets minor+patch', () => {
    expect(applyBump('3.2.1', 'major')).toBe('4.0.0');
  });

  it('bumps minor and resets patch', () => {
    expect(applyBump('3.2.1', 'minor')).toBe('3.3.0');
  });

  it('bumps patch', () => {
    expect(applyBump('3.2.1', 'patch')).toBe('3.2.2');
  });
});

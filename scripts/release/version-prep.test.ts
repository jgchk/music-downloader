import { describe, expect, it } from 'vitest';
import { assembleChangelog, compute, isReleaseTagTaken } from './version-prep.ts';
import type { ReleaseReader } from './reader.ts';
import type { RangeCommit } from './render-changelog-section.ts';

/**
 * `version:prep` is the release orchestrator: it anchors package.json to the last released tag and
 * assembles CHANGELOG.md from the branch's conventional commits. These specs pin the pure units it
 * is built from — the CHANGELOG front-matter surgery, the bump/anchor computation, and the
 * concurrent-branch collision guard — leaving the thin file-IO/CLI shell to be verified by
 * execution, as the rest of this tier is.
 */

const fullSha = (short: string): string => short.padEnd(40, '0');

/**
 * A read-only {@link ReleaseReader} over in-memory state. `compute` only consults `releaseTags` and
 * `rangeCommits`; the tree-reading members are stubbed since they belong to the write/check shell.
 */
const fakeReader = (state: { tags: string[]; commits: RangeCommit[] }): ReleaseReader => ({
  fetch() {
    /* no remote in a unit test */
  },
  releaseTags: () => state.tags,
  rangeCommits: () => state.commits,
  baseChangelog: () => '',
  committedPackageJson: () => '',
  committedChangelog: () => '',
});

describe('assembleChangelog', () => {
  const section =
    '## [3.5.4](https://example.com/compare/v3.5.3...v3.5.4) (2026-07-23)\n\n\n### Bug Fixes\n\n* a new thing\n\n';

  it('prepends the new section under the header, keeping the earlier releases and the front matter', () => {
    const base = `<!-- generated file — do not edit -->
# Changelog

All notable changes to this project will be documented in this file. See [commit-and-tag-version](https://github.com/absolute-version/commit-and-tag-version) for commit guidelines.

## [3.5.3](https://example.com/compare/v3.5.2...v3.5.3) (2026-07-01)


### Bug Fixes

* an older thing
`;
    const result = assembleChangelog(base, section);

    expect(result.startsWith('<!-- generated file — do not edit -->')).toBe(true);
    // exactly one canonical header, and the new release ahead of the old one
    expect(result.match(/# Changelog/g)).toHaveLength(1);
    expect(result.indexOf('## [3.5.4]')).toBeLessThan(result.indexOf('## [3.5.3]'));
    expect(result).toContain('an older thing');
  });

  it('builds a fresh changelog when the base is absent (a first release on a clean tree)', () => {
    const result = assembleChangelog('', section);

    expect(result.startsWith('# Changelog')).toBe(true);
    expect(result).toContain('## [3.5.4]');
  });

  it('prepends the section when the base has no prior release heading to anchor on', () => {
    const base =
      '# Changelog\n\nAll notable changes to this project will be documented in this file. See [commit-and-tag-version](https://github.com/absolute-version/commit-and-tag-version) for commit guidelines.\n';
    const result = assembleChangelog(base, section);

    expect(result).toContain('## [3.5.4]');
    expect(result).toContain('### Bug Fixes');
  });
});

describe('compute', () => {
  it('bumps and anchors on the highest release tag, ignoring a lower foreign lineage', async () => {
    const computed = await compute(
      fakeReader({
        tags: ['v0.1.8', 'v3.5.3', 'v0.1.7'],
        commits: [{ hash: fullSha('abc1234'), message: 'fix(slskd): parse per-user downloads' }],
      }),
    );

    expect(computed.version).toBe('3.5.4');
    expect(computed.bumped).toBe(true);
    expect(computed.section).toContain('### Bug Fixes');
  });

  it('takes the minor bump for a feat', async () => {
    const computed = await compute(
      fakeReader({
        tags: ['v3.5.3'],
        commits: [{ hash: fullSha('abc1234'), message: 'feat(web): add health endpoint' }],
      }),
    );

    expect(computed.version).toBe('3.6.0');
    expect(computed.section).toContain('### Features');
  });

  it('stays put with no section when the range has no releasable commits', async () => {
    const computed = await compute(
      fakeReader({
        tags: ['v3.5.3'],
        commits: [{ hash: fullSha('abc1234'), message: 'chore(deps): bump vitest' }],
      }),
    );

    expect(computed.version).toBe('3.5.3');
    expect(computed.bumped).toBe(false);
    expect(computed.section).toBe(null);
  });

  it('is idempotent — computing twice from the same state yields the same result', async () => {
    const reader = fakeReader({
      tags: ['v3.5.3'],
      commits: [{ hash: fullSha('abc1234'), message: 'fix(slskd): parse per-user downloads' }],
    });

    expect(await compute(reader)).toEqual(await compute(reader));
  });
});

/**
 * The collision guard for the past incident: two branches forked off one tag compute the same next
 * version, and the second to merge would silently overwrite the first's release. The `--check` job
 * fails loudly when the freshly-computed version already carries a release tag — but never on the
 * normal flow, where the next version has no tag yet.
 */
describe('isReleaseTagTaken', () => {
  it('is taken when a release tag for the computed version already exists (a concurrent branch shipped it)', () => {
    expect(isReleaseTagTaken('3.5.4', ['v3.5.3', 'v3.5.4'])).toBe(true);
  });

  it('is free when the next version has no tag yet (the normal bump)', () => {
    expect(isReleaseTagTaken('3.5.4', ['v3.5.3'])).toBe(false);
  });
});

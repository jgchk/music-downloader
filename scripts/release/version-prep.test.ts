import { describe, expect, it } from 'vitest';
import { assembleChangelog, compute, isReleaseTagTaken, run } from './version-prep.ts';
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
const fakeReader = (state: {
  tags: string[];
  commits: RangeCommit[];
  committedPackageJson?: string;
  committedChangelog?: string;
}): ReleaseReader => ({
  fetch() {
    /* no remote in a unit test */
  },
  releaseTags: () => state.tags,
  rangeCommits: () => state.commits,
  baseChangelog: () => '',
  committedPackageJson: () => state.committedPackageJson ?? '',
  committedChangelog: () => state.committedChangelog ?? '',
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

/**
 * Drives the `--check` orchestration end-to-end over a fake reader to prove the collision guard is
 * actually *wired* — compute → read `releaseTags()` → abort loudly, ahead of the version-match
 * check, and short-circuited on an unbumped range — not merely that its pure predicate is correct.
 * The captured effects stand in for the CLI's `process.exit`/stdout: `fail` aborts by throwing (it
 * returns `never`), so a rejection is the loud non-zero abort and no success line is logged.
 */
describe('run (--check collision guard wiring)', () => {
  const captureEffects = (): {
    logs: string[];
    effects: { fail: (message: string) => never; log: (message: string) => void };
  } => {
    const logs: string[] = [];
    return {
      logs,
      effects: {
        fail: (message: string): never => {
          throw new Error(message);
        },
        log: (message: string) => {
          logs.push(message);
        },
      },
    };
  };

  it('aborts loudly, ahead of the version-match check, when a concurrent branch tagged the computed version', async () => {
    const { effects, logs } = captureEffects();
    // A `fix` off v3.5.3 computes v3.5.4. Between anchoring (which reads the tags, then the range)
    // and the guard's fresh read, a concurrent branch's v3.5.4 tag becomes visible — the exact race
    // the guard defends. The committed package.json deliberately does NOT match the computed 3.5.4,
    // so if the guard ever regressed *after* the version-match check, that check would abort first
    // with a different message and this assertion on the rebase message would catch it.
    let raced = false;
    const reader: ReleaseReader = {
      ...fakeReader({ tags: [], commits: [], committedPackageJson: '{ "version": "3.5.3" }' }),
      releaseTags: () => (raced ? ['v3.5.3', 'v3.5.4'] : ['v3.5.3']),
      rangeCommits: () => {
        raced = true;
        return [{ hash: fullSha('abc1234'), message: 'fix(slskd): parse per-user downloads' }];
      },
    };

    await expect(run(reader, true, effects)).rejects.toThrow(
      /v3\.5\.4 is already a release tag[\s\S]*Rebase onto origin\/main/,
    );
    expect(logs).toEqual([]);
  });

  it('does not fire the guard on a normal prep whose computed version has no tag yet', async () => {
    const { effects, logs } = captureEffects();
    const reader = fakeReader({
      tags: ['v3.5.3'],
      commits: [{ hash: fullSha('abc1234'), message: 'fix(slskd): parse per-user downloads' }],
      committedPackageJson: '{ "version": "3.5.4" }',
      committedChangelog: '## [3.5.4](https://example.com/compare/v3.5.3...v3.5.4) (2026-07-23)\n',
    });

    await expect(run(reader, true, effects)).resolves.toBeUndefined();
    expect(logs.join('')).toContain('branch is prepped for 3.5.4');
  });

  it('short-circuits the guard on an unbumped range even though the anchor tag exists', async () => {
    const { effects, logs } = captureEffects();
    // No releasable commits: the version stays at the anchor v3.5.3, whose tag of course exists.
    // Only the `bumped &&` short-circuit keeps the guard from misreading that as a collision.
    const reader = fakeReader({
      tags: ['v3.5.3'],
      commits: [{ hash: fullSha('abc1234'), message: 'chore(deps): bump vitest' }],
      committedPackageJson: '{ "version": "3.5.3" }',
    });

    await expect(run(reader, true, effects)).resolves.toBeUndefined();
    expect(logs.join('')).toContain('branch is prepped for 3.5.3');
  });
});

import { describe, expect, it } from 'vitest';
import {
  anchorVersion,
  assembleChangelog,
  compute,
  isReleaseTagTaken,
  run,
  type Computed,
  type PrepEffects,
} from './version-prep.ts';
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

/**
 * The captured side effects, standing in for the CLI's `process.exit`, stdout, and working-tree
 * writes. `fail` aborts by throwing (it returns `never`), so a rejection is the loud non-zero abort.
 *
 * Both file sinks are captured, never defaulted: `run` writes package.json AND CHANGELOG.md, and a
 * test that supplied only the first used to write the repository's real CHANGELOG.md whenever a
 * guard regressed. `PrepEffects` now requires both, so this helper is the only way in.
 */
const captureEffects = (
  manifestSource = '{ "version": "0.0.0" }',
): {
  logs: string[];
  manifestWrites: string[];
  changelogWrites: string[];
  effects: PrepEffects;
} => {
  const logs: string[] = [];
  const manifestWrites: string[] = [];
  const changelogWrites: string[] = [];
  return {
    logs,
    manifestWrites,
    changelogWrites,
    effects: {
      fail: (message: string): never => {
        throw new Error(message);
      },
      log: (message: string) => {
        logs.push(message);
      },
      manifest: {
        read: () => manifestSource,
        write: (content: string) => {
          manifestWrites.push(content);
        },
      },
      changelog: {
        write: (content: string) => {
          changelogWrites.push(content);
        },
      },
    },
  };
};

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
  /**
   * Compute and unwrap. A computation failure (the renderer's preset contract breaking) is modeled
   * as a value, so unwrapping doubles as the assertion that these ranges compute at all.
   */
  const computeOrFail = async (reader: ReleaseReader): Promise<Computed> => {
    const result = await compute(reader);
    if (!result.ok) expect.unreachable(result.reason);
    return result.computed;
  };

  /**
   * Compute a range that must bump. The `bumped` discriminant is what carries `section`, so this
   * narrowing is the only way to reach it — a release that computes no section is a different type,
   * not a null field.
   */
  const computeBumped = async (
    reader: ReleaseReader,
  ): Promise<Extract<Computed, { bumped: true }>> => {
    const computed = await computeOrFail(reader);
    if (!computed.bumped) expect.unreachable('the range has releasable commits');
    return computed;
  };

  it('bumps and anchors on the highest release tag, ignoring a lower foreign lineage', async () => {
    const computed = await computeBumped(
      fakeReader({
        tags: ['v0.1.8', 'v3.5.3', 'v0.1.7'],
        commits: [{ hash: fullSha('abc1234'), message: 'fix(slskd): parse per-user downloads' }],
      }),
    );

    expect(computed.version).toBe('3.5.4');
    expect(computed.section).toContain('### Bug Fixes');
  });

  it('takes the minor bump for a feat', async () => {
    const computed = await computeBumped(
      fakeReader({
        tags: ['v3.5.3'],
        commits: [{ hash: fullSha('abc1234'), message: 'feat(web): add health endpoint' }],
      }),
    );

    expect(computed.version).toBe('3.6.0');
    expect(computed.section).toContain('### Features');
  });

  it('stays put, carrying no section at all, when the range has no releasable commits', async () => {
    const computed = await computeOrFail(
      fakeReader({
        tags: ['v3.5.3'],
        commits: [{ hash: fullSha('abc1234'), message: 'chore(deps): bump vitest' }],
      }),
    );

    // Exhaustive, not field-by-field: an unbumped computation has no `section` member to be null.
    expect(computed).toEqual({ version: '3.5.3', bumped: false });
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
  it('aborts loudly, ahead of the version-match check, when a concurrent branch tagged the computed version', async () => {
    const { effects, logs } = captureEffects();
    // A `fix` off v3.5.3 computes v3.5.4. Between anchoring (which reads the tags, then the range)
    // and the guard's fresh read, a concurrent branch's v3.5.4 tag becomes visible — the exact race
    // the guard defends. The committed package.json deliberately does NOT match the computed 3.5.4,
    // so if the guard ever regressed *after* the version-match check, that check would abort first
    // with a different message and this assertion on the rebase message would catch it.
    let isRaced = false;
    const reader: ReleaseReader = {
      ...fakeReader({ tags: [], commits: [], committedPackageJson: '{ "version": "3.5.3" }' }),
      releaseTags: () => (isRaced ? ['v3.5.3', 'v3.5.4'] : ['v3.5.3']),
      rangeCommits: () => {
        isRaced = true;
        return [{ hash: fullSha('abc1234'), message: 'fix(slskd): parse per-user downloads' }];
      },
    };

    await expect(run(reader, true, effects)).rejects.toThrow(
      /v3\.5\.4 is already a release tag[\s\S]*Rebase onto origin\/main/,
    );
    expect(logs).toEqual([]);
  });

  it('does not fire the guard on a normal prep whose computed version has no tag yet', async () => {
    const { effects, logs, manifestWrites, changelogWrites } = captureEffects();
    const reader = fakeReader({
      tags: ['v3.5.3'],
      commits: [{ hash: fullSha('abc1234'), message: 'fix(slskd): parse per-user downloads' }],
      committedPackageJson: '{ "version": "3.5.4" }',
      committedChangelog: '## [3.5.4](https://example.com/compare/v3.5.3...v3.5.4) (2026-07-23)\n',
    });

    await expect(run(reader, true, effects)).resolves.toBeUndefined();
    expect(logs.join('')).toContain('branch is prepped for 3.5.4');
    // `--check` is the CI gate: it verifies in memory and never touches the tree.
    expect([...manifestWrites, ...changelogWrites]).toEqual([]);
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

describe('anchorVersion', () => {
  it('rewrites the version field, preserving the rest of the source', () => {
    const source =
      '{\n  "name": "music-downloader",\n  "version": "3.5.3",\n  "private": true\n}\n';

    expect(anchorVersion(source, '3.5.4')).toBe(
      '{\n  "name": "music-downloader",\n  "version": "3.5.4",\n  "private": true\n}\n',
    );
  });

  it('accepts an unbumped prep, where the anchored version is already in place', () => {
    const source = '{ "version": "3.5.3" }';

    expect(anchorVersion(source, '3.5.3')).toBe(source);
  });

  it('writes a `$`-bearing version literally, never as a replacement pattern', () => {
    // The version is data, not a pattern. Passed as a replacement STRING, `$&` expands to the whole
    // match — splicing the old `"version": "3.5.3"` text back into the field and corrupting the
    // manifest (here loudly, as unparseable JSON; `$1`/`` $` ``/`$'` corrupt it just as silently).
    // Only the replacer function keeps the computed version verbatim.
    const source = '{ "version": "3.5.3" }';

    expect(anchorVersion(source, '3.5.4-rc.$&')).toBe('{ "version": "3.5.4-rc.$&" }');
  });

  it('returns null instead of silently writing an unanchored file when the pattern finds no purchase', () => {
    // The rot scenario: package.json's version field changes shape (or vanishes) and the anchor
    // regex no longer matches — String.replace would return the source unchanged, and the old
    // shell logged "prepared" over a file it never touched.
    const source = '{ "name": "music-downloader", "ver": "3.5.3" }';

    expect(anchorVersion(source, '3.5.4')).toBeNull();
  });

  it('returns null when the replacement lands somewhere other than the real version field', () => {
    // First-match semantics: a shape where the match is not the manifest's own version field must
    // fail the post-condition (the parsed manifest does not carry the computed version).
    const source = '{ "scripts": { "version": "echo" }, "version-note": "3.5.3" }';

    expect(anchorVersion(source, '3.5.4')).toBeNull();
  });
});

/**
 * The write path applies the computed state to the working tree. Every guard here defends the same
 * thing — CHANGELOG.md's history — and each one failed silently at some point: an unanchorable
 * manifest logged "prepared" over a file it never touched, and a base CHANGELOG.md that read back
 * empty because the VCS call *failed* (rather than because the file was absent) rewrote the file
 * with the whole history dropped and logged success. Nothing may be written unless everything can be.
 */
describe('run (write path)', () => {
  const releasableRange = (committedChangelog?: string): ReleaseReader =>
    fakeReader({
      tags: ['v3.5.3'],
      commits: [{ hash: fullSha('abc1234'), message: 'fix(slskd): parse per-user downloads' }],
      committedChangelog,
    });

  it('prepends the new section to the base changelog and anchors the bumped version', async () => {
    const { effects, logs, manifestWrites, changelogWrites } =
      captureEffects('{ "version": "3.5.3" }');
    const reader: ReleaseReader = {
      ...releasableRange(),
      baseChangelog: () =>
        '# Changelog\n\n## [3.5.3](https://example.com/x) (2026-07-01)\n\n* old\n',
    };

    await expect(run(reader, false, effects)).resolves.toBeUndefined();

    expect(manifestWrites).toEqual(['{ "version": "3.5.4" }']);
    expect(changelogWrites[0]).toContain('## [3.5.4]');
    expect(changelogWrites[0]).toContain('* old'); // the history survives
    expect(logs.join('')).toContain('prepared 3.5.4');
  });

  it('restores the base changelog untouched, and says so, when nothing is releasable', async () => {
    const base = '# Changelog\n\n## [3.5.3](https://example.com/x) (2026-07-01)\n\n* old\n';
    const { effects, logs, manifestWrites, changelogWrites } =
      captureEffects('{ "version": "3.5.3" }');
    const reader: ReleaseReader = {
      ...fakeReader({
        tags: ['v3.5.3'],
        commits: [{ hash: fullSha('abc1234'), message: 'chore(deps): bump vitest' }],
      }),
      baseChangelog: () => base,
    };

    await expect(run(reader, false, effects)).resolves.toBeUndefined();

    expect(changelogWrites).toEqual([base]);
    expect(manifestWrites).toEqual(['{ "version": "3.5.3" }']);
    expect(logs.join('')).toContain('no releasable commits — staying at 3.5.3');
  });

  it('aborts and writes nothing when the manifest cannot be anchored', async () => {
    const { effects, logs, manifestWrites, changelogWrites } = captureEffects(
      '{ "name": "music-downloader", "ver": "3.5.3" }',
    );

    await expect(run(releasableRange(), false, effects)).rejects.toThrow(
      /could not anchor 3\.5\.4 .* left untouched/,
    );
    expect([...manifestWrites, ...changelogWrites]).toEqual([]);
    expect(logs).toEqual([]);
  });

  it('aborts and writes nothing when the base changelog cannot be read', async () => {
    // A read that FAILED — an unresolvable base revision, a revset function this jj version lacks,
    // an unusable repo. Reassembling around it would drop the release history; the abort has to
    // come before the manifest write, or a "failed" prep leaves a half-bumped tree behind.
    const { effects, logs, manifestWrites, changelogWrites } =
      captureEffects('{ "version": "3.5.3" }');
    const reader: ReleaseReader = {
      ...releasableRange(),
      baseChangelog: () => {
        throw new Error("Error: Revision `main@origin` doesn't exist");
      },
    };

    await expect(run(reader, false, effects)).rejects.toThrow(
      /could not read CHANGELOG\.md[\s\S]*main@origin/,
    );
    expect([...manifestWrites, ...changelogWrites]).toEqual([]);
    expect(logs).toEqual([]);
  });

  it('refuses to write when the base changelog is empty but the committed tree carries one', async () => {
    // Defence in depth behind the reader's absent-vs-failed discriminator: whatever the cause, an
    // empty base against a committed CHANGELOG.md means this write would destroy release history.
    const { effects, logs, manifestWrites, changelogWrites } =
      captureEffects('{ "version": "3.5.3" }');
    const reader: ReleaseReader = {
      ...releasableRange(
        '# Changelog\n\n## [3.5.3](https://example.com/x) (2026-07-01)\n\n* old\n',
      ),
      baseChangelog: () => '',
    };

    await expect(run(reader, false, effects)).rejects.toThrow(
      /base CHANGELOG\.md .* empty[\s\S]*committed/,
    );
    expect([...manifestWrites, ...changelogWrites]).toEqual([]);
    expect(logs).toEqual([]);
  });

  it('writes a first changelog when neither the base nor the committed tree has one', async () => {
    // The guard above must not block a genuine first release: absent everywhere is absent, not loss.
    const { effects, changelogWrites } = captureEffects('{ "version": "3.5.3" }');

    await expect(run(releasableRange(''), false, effects)).resolves.toBeUndefined();

    expect(changelogWrites[0]).toContain('## [3.5.4]');
  });
});

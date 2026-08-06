import { describe, expect, it, vi } from 'vitest';
import createPreset from 'conventional-changelog-conventionalcommits';
import { renderChangelogSection, type RangeCommit } from './render-changelog-section.ts';
import { run } from './version-prep.ts';
import type { ReleaseReader } from './reader.ts';

/**
 * The renderer reads two option bags — `parser` and `writer` — off the conventionalcommits preset,
 * whose declared return type is `{}` (see the `Preset` interface's note). The types therefore cannot
 * catch a rename: if a dependency bump renames either key, reading it yields `undefined`, the commit
 * parser and the changelog writer each fall back to their own defaults, and the release ships a
 * wrong-shaped CHANGELOG section with nothing flagging it. That is why the preset is *validated* at
 * this boundary rather than asserted, and why a preset that no longer satisfies the expected shape is
 * a modeled failure the CLI reports and exits on.
 *
 * These specs stub the preset to stage that bump. The real preset's conformance is pinned by the
 * sibling spec, which renders through it end to end.
 */
vi.mock('conventional-changelog-conventionalcommits', () => ({ default: vi.fn() }));

const commits: RangeCommit[] = [{ hash: 'abc1234'.padEnd(40, '0'), message: 'feat(web): a thing' }];
const versions = { version: '3.2.0', previousVersion: '3.1.0' };

describe('renderChangelogSection (preset shape)', () => {
  it('fails, naming the package, when the preset no longer carries the option bags it is read for', async () => {
    vi.mocked(createPreset).mockReturnValue({ commitParser: {}, changelogWriter: {} });

    const rendered = await renderChangelogSection(commits, versions);

    if (rendered.ok) expect.unreachable('a preset missing both option bags must not render');
    expect(rendered.reason).toContain('conventional-changelog-conventionalcommits');
    // The reason is what the operator acts on, so it has to name the bags to go re-derive.
    expect(rendered.reason).toContain('`parser`');
    expect(rendered.reason).toContain('`writer`');
  });

  it('fails when only one of the two option bags survives the bump', async () => {
    // The half-failure is the dangerous one: `parser` still parses, and only the writer silently
    // falls back to its default template — a plausible-looking section that is not ours.
    vi.mocked(createPreset).mockReturnValue({ parser: {}, changelogWriter: {} });

    const rendered = await renderChangelogSection(commits, versions);

    expect(rendered.ok).toBe(false);
  });
});

/**
 * The failure has to reach the operator: this tier is a CLI where the exit status is the interface,
 * so a broken preset must abort `version:prep` with the reason and leave the tree untouched — never
 * prep a release around a section the renderer could not produce faithfully.
 */
describe('run (broken preset contract)', () => {
  it('aborts version:prep with the reason and writes nothing', async () => {
    vi.mocked(createPreset).mockReturnValue({});
    const logs: string[] = [];
    const writes: string[] = [];
    const reader: ReleaseReader = {
      fetch() {
        /* no remote in a unit test */
      },
      releaseTags: () => ['v3.5.3'],
      rangeCommits: () => commits,
      baseChangelog: () => '',
      committedPackageJson: () => '',
      committedChangelog: () => '',
    };

    await expect(
      run(reader, false, {
        fail: (message: string): never => {
          throw new Error(message);
        },
        log: (message: string) => {
          logs.push(message);
        },
        // Both sinks captured. This spec drives WRITE mode, and CHANGELOG.md used to be written
        // straight to `process.cwd()` outside the injected effects — so a regression in the guard
        // under test turned this red test into an overwrite of the repository's own CHANGELOG.md.
        manifest: {
          read: () => '{ "version": "3.5.3" }',
          write: (content: string) => {
            writes.push(content);
          },
        },
        changelog: {
          write: (content: string) => {
            writes.push(content);
          },
        },
      }),
    ).rejects.toThrow(/version:prep: conventional-changelog-conventionalcommits no longer returns/);
    expect(writes).toEqual([]);
    expect(logs).toEqual([]);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderChangelogSection, type RangeCommit } from './render-changelog-section.ts';

/**
 * The renderer reproduces commit-and-tag-version 12.7.3's CHANGELOG output as a pure function of the
 * range commits — same conventionalcommits preset, same config-spec DEFAULT `types` (which hide
 * `perf`), same explicit GitHub URLs (there is no `repository` field in package.json). These specs
 * pin the fidelity traps; byte-for-byte parity with catv over a real range is verified by execution.
 */
const commit = (hash: string, message: string): RangeCommit => ({ hash, message });
const fullSha = (short: string): string => short.padEnd(40, '0');

/**
 * Render and unwrap. The renderer models "the preset no longer hands back the option bags this is
 * built on" as a failure value (staged in the sibling `.preset` spec), so unwrapping here doubles as
 * the standing assertion that the *installed* preset still satisfies that shape.
 */
const render = async (
  commits: RangeCommit[],
  versions: { version: string; previousVersion: string },
): Promise<string> => {
  const rendered = await renderChangelogSection(commits, versions);
  if (!rendered.ok) expect.unreachable(rendered.reason);
  return rendered.section;
};

describe('renderChangelogSection', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the heading with a compare link and today (UTC) as the date', async () => {
    // The date is the writer's own default — today — so the clock is frozen rather than the
    // expectation recomputed from the real one, which flakes when a UTC midnight falls between the
    // render and the assertion. Only `Date` is faked, leaving the writer's async plumbing alone.
    vi.useFakeTimers({ toFake: ['Date'], now: Date.UTC(2026, 6, 23, 0, 30) });

    const section = await render([commit(fullSha('abc1234'), 'feat(web): add a thing')], {
      version: '3.2.0',
      previousVersion: '3.1.0',
    });

    expect(section).toContain(
      `## [3.2.0](https://github.com/jgchk/music-downloader/compare/v3.1.0...v3.2.0) (2026-07-23)`,
    );
  });

  it('groups a feat under Features with a short-hash link to the full SHA', async () => {
    const sha = fullSha('abc1234');
    const section = await render([commit(sha, 'feat(web): add a thing')], {
      version: '3.2.0',
      previousVersion: '3.1.0',
    });
    expect(section).toContain('### Features');
    expect(section).toContain(
      `* **web:** add a thing ([abc1234](https://github.com/jgchk/music-downloader/commit/${sha}))`,
    );
  });

  it('groups a fix under Bug Fixes', async () => {
    const section = await render([commit(fullSha('def5678'), 'fix(api): 404 mapping')], {
      version: '3.2.1',
      previousVersion: '3.2.0',
    });
    expect(section).toContain('### Bug Fixes');
    expect(section).toContain('* **api:** 404 mapping');
  });

  it('HIDES perf (no Performance Improvements section) — the config-spec fidelity trap', async () => {
    const section = await render([commit(fullSha('aaa1111'), 'perf(reactor): batch writes')], {
      version: '3.2.1',
      previousVersion: '3.2.0',
    });
    expect(section).not.toContain('Performance Improvements');
    expect(section).not.toContain('batch writes');
  });

  it('renders a BREAKING CHANGES block with the ⚠ marker', async () => {
    const section = await render(
      [
        commit(
          fullSha('bbb2222'),
          'feat(api)!: drop v1\n\nBREAKING CHANGE: the v1 endpoint is gone',
        ),
      ],
      { version: '4.0.0', previousVersion: '3.2.1' },
    );
    expect(section).toContain('### ⚠ BREAKING CHANGES');
    expect(section).toContain('the v1 endpoint is gone');
  });

  it('linkifies a closed issue from the footer', async () => {
    const section = await render(
      [commit(fullSha('ccc3333'), 'fix(mcp): remove auth\n\ncloses #51')],
      { version: '2.5.1', previousVersion: '2.5.0' },
    );
    expect(section).toContain(
      ', closes [#51](https://github.com/jgchk/music-downloader/issues/51)',
    );
  });

  it('omits an empty group when the only commit is hidden (perf-only → almost-empty section)', async () => {
    const section = await render([commit(fullSha('ddd4444'), 'perf(x): y')], {
      version: '1.0.1',
      previousVersion: '1.0.0',
    });
    expect(section).not.toContain('###');
  });
});

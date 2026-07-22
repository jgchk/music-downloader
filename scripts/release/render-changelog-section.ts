import { createRequire } from 'node:module';

// These conventional-changelog packages are legacy CommonJS with no `main`/`exports` field, so a
// bare ESM `import` can't resolve them; `require` falls back to their index.js. Loading them through
// createRequire keeps the pinned specifiers version-agnostic.
const require = createRequire(import.meta.url);
const ccParser = require('conventional-commits-parser') as {
  sync: (message: string, options: unknown) => Record<string, unknown>;
};
const writer = require('conventional-changelog-writer') as {
  parseArray: (commits: unknown, context: unknown, options: unknown) => string;
};
const conventionalcommitsPreset = require('conventional-changelog-conventionalcommits') as (
  config: unknown,
) => Promise<{ parserOpts: unknown; writerOpts: unknown }>;

/**
 * Render one release's CHANGELOG.md section, byte-for-byte as commit-and-tag-version 12.7.3 did,
 * but as a pure function of (range commits, versions) with no git/disk access. catv drove the whole
 * conventional-changelog toolchain off a live git log; we feed the same preset the same inputs and
 * call its writer directly, so the release lifecycle no longer needs a git working tree (change:
 * jj-native-version-prep).
 *
 * The fidelity traps this reproduces exactly:
 *  - catv does NOT use the conventionalcommits preset's built-in `types` (which surface `perf` as
 *    "Performance Improvements"); it feeds the conventional-changelog-config-spec 2.1.0 DEFAULT
 *    types, inlined below, where `perf` is HIDDEN. A perf-only bump therefore renders an (almost)
 *    empty section — matching catv.
 *  - there is no `repository` field in package.json, so catv let conventional-changelog-core derive
 *    the GitHub URLs from the origin remote. We supply host/owner/repository explicitly instead.
 *  - the date is omitted so the writer defaults it to today's UTC date — exactly catv's behaviour
 *    for a fresh release section.
 */

/** The config-spec 2.1.0 default `types` — the exact array catv passes the preset (perf hidden). */
const TYPES = [
  { type: 'feat', section: 'Features' },
  { type: 'fix', section: 'Bug Fixes' },
  { type: 'chore', hidden: true },
  { type: 'docs', hidden: true },
  { type: 'style', hidden: true },
  { type: 'refactor', hidden: true },
  { type: 'perf', hidden: true },
  { type: 'test', hidden: true },
] as const;

const HOST = 'https://github.com';
const OWNER = 'jgchk';
const REPOSITORY = 'music-downloader';

// The conventionalcommits preset's own default URL templates, supplied explicitly (no repository
// field in package.json means the preset can't infer them from a config file).
const COMMIT_URL_FORMAT = '{{host}}/{{owner}}/{{repository}}/commit/{{hash}}';
const COMPARE_URL_FORMAT =
  '{{host}}/{{owner}}/{{repository}}/compare/{{previousTag}}...{{currentTag}}';
const ISSUE_URL_FORMAT = '{{host}}/{{owner}}/{{repository}}/issues/{{id}}';

/** A commit in the release range: its full SHA (for the [shorthash](commit-url) link) and message. */
export interface RangeCommit {
  hash: string;
  message: string;
}

/**
 * Render the section body-with-heading for `version` from the commits in the range since
 * `previousVersion`. Returns the raw writer output (the same `content` catv prepended to
 * CHANGELOG.md), including its trailing blank lines.
 */
export async function renderChangelogSection(
  commits: readonly RangeCommit[],
  opts: { version: string; previousVersion: string },
): Promise<string> {
  const { parserOpts, writerOpts } = await conventionalcommitsPreset({
    types: TYPES,
    commitUrlFormat: COMMIT_URL_FORMAT,
    compareUrlFormat: COMPARE_URL_FORMAT,
    issueUrlFormat: ISSUE_URL_FORMAT,
  });

  const parsed = commits.map((c) => {
    const commit = ccParser.sync(c.message, parserOpts);
    commit.hash = c.hash;
    return commit;
  });

  const context = {
    host: HOST,
    owner: OWNER,
    repository: REPOSITORY,
    version: opts.version,
    previousTag: `v${opts.previousVersion}`,
    currentTag: `v${opts.version}`,
    linkCompare: true,
  };

  return writer.parseArray(parsed, context, writerOpts);
}

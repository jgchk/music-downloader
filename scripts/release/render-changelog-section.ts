import { CommitParser } from 'conventional-commits-parser';
import { writeChangelogString } from 'conventional-changelog-writer';
import createPreset from 'conventional-changelog-conventionalcommits';

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

/**
 * The config-spec 2.1.0 default `types` — the exact array catv passes the preset (perf hidden).
 * conventional-changelog-conventionalcommits v10 renamed the per-type `hidden: true` flag to
 * `effect: 'hidden'` (see its `isTypeEffect`), so the hidden types are expressed that way here.
 */
const TYPES = [
  { type: 'feat', section: 'Features' },
  { type: 'fix', section: 'Bug Fixes' },
  { type: 'chore', effect: 'hidden' },
  { type: 'docs', effect: 'hidden' },
  { type: 'style', effect: 'hidden' },
  { type: 'refactor', effect: 'hidden' },
  { type: 'perf', effect: 'hidden' },
  { type: 'test', effect: 'hidden' },
] as const;

const HOST = 'https://github.com';
const OWNER = 'jgchk';
const REPOSITORY = 'music-downloader';

/** A commit in the release range: its full SHA (for the [shorthash](commit-url) link) and message. */
export interface RangeCommit {
  hash: string;
  message: string;
}

/**
 * What `createPreset` actually returns. conventional-changelog-conventionalcommits 10.2.1 declares
 * its default export as `(config?: PresetConfig) => {}` (`src/index.d.ts`) — an upstream typing
 * gap, not a missing typing — so the two option bags it really hands back are named here, derived
 * from the consumers' own signatures rather than restated by hand.
 */
interface Preset {
  readonly parser: ConstructorParameters<typeof CommitParser>[0];
  readonly writer: Parameters<typeof writeChangelogString>[2];
}

/** The commit shape the writer consumes, taken from its own signature. */
type WriterCommit =
  Extract<Parameters<typeof writeChangelogString>[0], Iterable<unknown>> extends Iterable<infer C>
    ? C
    : never;

/**
 * Render the section body-with-heading for `version` from the commits in the range since
 * `previousVersion`. Returns the raw writer output (the same `content` catv prepended to
 * CHANGELOG.md), including its trailing blank lines.
 */
export async function renderChangelogSection(
  commits: readonly RangeCommit[],
  options: { version: string; previousVersion: string },
): Promise<string> {
  // The preset's default URL format functions derive commit/compare/issue links from
  // context.host/owner/repository (the same shapes catv's explicit templates produced), so we no
  // longer pass URL templates — the `context` below supplies host/owner/repository directly.
  const { parser: parserOptions, writer: writerOptions } = createPreset({
    types: [...TYPES],
  }) as Preset;

  const parser = new CommitParser(parserOptions);
  const parsed: WriterCommit[] = commits.map((c) => ({ ...parser.parse(c.message), hash: c.hash }));

  const context = {
    host: HOST,
    owner: OWNER,
    repository: REPOSITORY,
    version: options.version,
    previousTag: `v${options.previousVersion}`,
    currentTag: `v${options.version}`,
    linkCompare: true,
    // v9's writer template defaults the commit path segment to `commits` (plural); catv used the
    // singular `commit` (matching GitHub's own /commit/<sha> URL), so pin it to preserve fidelity.
    commit: 'commit',
  };

  return writeChangelogString(parsed, context, writerOptions);
}

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
 *
 * `NonNullable` is load-bearing. Both consumers take their option bag OPTIONALLY
 * (`ParserOptions | undefined`, `Options<CommitKnownProps> | undefined`), so without it
 * `{ parser: undefined, writer: undefined }` — the exact degraded shape {@link isPreset} exists to
 * reject — satisfied this interface, and the members stayed `| undefined` downstream of the guard.
 * The declared type now states the invariant the predicate checks.
 */
interface Preset {
  readonly parser: NonNullable<ConstructorParameters<typeof CommitParser>[0]>;
  readonly writer: NonNullable<Parameters<typeof writeChangelogString>[2]>;
}

/**
 * The keys {@link isPreset} checks for, kept in step with {@link Preset} BOTH ways. A list declared
 * `satisfies readonly (keyof Preset)[]` is only a subset check — a member ADDED to the interface
 * leaves it satisfying, so the guard silently stops checking the new bag. `Record<keyof Preset, _>`
 * fails on a missing key and (as an object literal) on an excess one, so a rename, a removal, and
 * an addition all break the build here.
 */
const PRESET_SHAPE = { parser: true, writer: true } satisfies Record<keyof Preset, true>;

// `Object.keys` is typed `string[]`; the shape above is the declaration this narrows back to.
const PRESET_KEYS = Object.keys(PRESET_SHAPE) as readonly (keyof Preset)[];

/**
 * Validate the preset at the boundary instead of asserting it. Because its declared return type is
 * `{}`, a dependency bump that renames either option bag typechecks silently: the member reads as
 * `undefined`, `CommitParser` and `writeChangelogString` each fall back to their own defaults, and
 * the release ships a wrong-shaped CHANGELOG section that nothing flags. The bags' own contents are
 * third-party opaque types, so "present and an object" is the whole checkable claim — which is
 * exactly the claim a rename breaks.
 */
function isPreset(value: unknown): value is Preset {
  if (typeof value !== 'object' || value === null) return false;
  // The one narrowing: reading members off an already-checked non-null object yields `unknown`.
  const members = value as Record<string, unknown>;
  return PRESET_KEYS.every((key) => typeof members[key] === 'object' && members[key] !== null);
}

/**
 * The renderer's outcome as a value. The failure is a broken dependency contract, not a business
 * outcome, and the release tooling is a CLI whose exit status is its interface — so the caller
 * reports `reason` and exits non-zero rather than shipping a default-rendered section.
 */
export type RenderedSection =
  { readonly ok: true; readonly section: string } | { readonly ok: false; readonly reason: string };

/** The commit shape the writer consumes, taken from its own signature. */
type WriterCommit =
  Extract<Parameters<typeof writeChangelogString>[0], Iterable<unknown>> extends Iterable<infer C>
    ? C
    : never;

/**
 * Render the section body-with-heading for `version` from the commits in the range since
 * `previousVersion`. On success the section is the raw writer output (the same `content` catv
 * prepended to CHANGELOG.md), including its trailing blank lines; a preset that no longer satisfies
 * {@link Preset} yields a failure instead of a section rendered from the toolchain's own defaults.
 */
export async function renderChangelogSection(
  commits: readonly RangeCommit[],
  options: { version: string; previousVersion: string },
): Promise<RenderedSection> {
  const preset: unknown = createPreset({ types: [...TYPES] });
  if (!isPreset(preset)) {
    return {
      ok: false,
      reason:
        `conventional-changelog-conventionalcommits no longer returns the ` +
        `${PRESET_KEYS.map((key) => `\`${key}\``).join(' and ')} option bags this renderer is ` +
        `built on, so the CHANGELOG section cannot be rendered faithfully. Re-derive the \`Preset\` ` +
        `shape in render-changelog-section.ts against the installed version before releasing.`,
    };
  }

  // The preset's default URL format functions derive commit/compare/issue links from
  // context.host/owner/repository (the same shapes catv's explicit templates produced), so we no
  // longer pass URL templates — the `context` below supplies host/owner/repository directly.
  const { parser: parserOptions, writer: writerOptions } = preset;

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

  return { ok: true, section: await writeChangelogString(parsed, context, writerOptions) };
}

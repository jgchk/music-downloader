/**
 * Whether a commit range warrants a release, and at what level. commit-and-tag-version would bump at
 * least a patch for *any* range (including chore/docs-only); {@link hasReleasableCommits} restores
 * semantic-release's behaviour so that a PR with no `feat`/`fix`/`perf` and no breaking change
 * produces no version bump at all.
 *
 * A single commit is releasable when its conventional header type is `feat`, `fix`, or `perf`, when
 * the header carries a breaking-change `!` (`type!:` or `type(scope)!:`), or when its body has a
 * `BREAKING CHANGE:` / `BREAKING-CHANGE:` footer. The `chore(release): x.y.z` bump commit is a
 * `chore` and is therefore ignored, keeping reruns stable.
 *
 * {@link bumpLevel} reduces a range to the semver level catv would have chosen from the same
 * headers: any breaking marker → `major`, else any `feat` → `minor`, else any `fix`/`perf` →
 * `patch`, else `null` (no release). `perf` still bumps a patch but renders an empty section (the
 * config-spec hides it) — matching catv exactly.
 */
const RELEASABLE_TYPES = new Set(['feat', 'fix', 'perf']);
const HEADER = /^(\w+)(?:\([^)]*\))?(!)?:/;
const BREAKING_FOOTER = /^BREAKING[ -]CHANGE:/m;

export type BumpLevel = 'major' | 'minor' | 'patch';

/** The level a single commit contributes, or `null` when it is not releasable. */
function levelOf(message: string): BumpLevel | null {
  const header = HEADER.exec(message);
  if (header !== null) {
    const [, type, bang] = header;
    if (bang === '!' || BREAKING_FOOTER.test(message)) return 'major';
    if (type === 'feat') return 'minor';
    if (RELEASABLE_TYPES.has(type!)) return 'patch';
    // A non-releasable type can still carry a breaking footer.
    if (BREAKING_FOOTER.test(message)) return 'major';
    return null;
  }
  return BREAKING_FOOTER.test(message) ? 'major' : null;
}

const RANK: Record<BumpLevel, number> = { patch: 1, minor: 2, major: 3 };

/** The highest level across the range, or `null` when nothing in it warrants a release. */
export function bumpLevel(messages: readonly string[]): BumpLevel | null {
  let best: BumpLevel | null = null;
  for (const message of messages) {
    const level = levelOf(message);
    if (level !== null && (best === null || RANK[level] > RANK[best])) {
      best = level;
    }
  }
  return best;
}

export function hasReleasableCommits(messages: readonly string[]): boolean {
  return bumpLevel(messages) !== null;
}

/** Increment `version` (a plain `x.y.z`) by `level`, resetting lower components as semver dictates. */
export function applyBump(version: string, level: BumpLevel): string {
  const [major, minor, patch] = version.split('.').map(Number) as [number, number, number];
  if (level === 'major') return `${major + 1}.0.0`;
  if (level === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

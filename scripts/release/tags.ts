/**
 * The last released version, from the release tags reachable on the released mainline. The
 * monorepo merge made `git describe` ambiguous — the imported importer lineage carries its own
 * `v0.1.x` tags, and describe picks by commit distance, not by release recency — so the anchor is
 * computed here instead: highest plain `vX.Y.Z` among the tags the caller collected from
 * `git tag -l 'v*' --merged origin/main` (foreign-lineage tags are unreachable from main and
 * pre-release/malformed tags are ignored).
 */
const RELEASE_TAG = /^v(\d+)\.(\d+)\.(\d+)$/;

export function latestReleaseVersion(tags: readonly string[]): string {
  const releases = tags
    .map((tag) => RELEASE_TAG.exec(tag))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => [Number(m[1]), Number(m[2]), Number(m[3])] as const);

  if (releases.length === 0) {
    throw new Error('no v* release tag found on the released mainline');
  }

  releases.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  const [major, minor, patch] = releases[releases.length - 1]!;
  return `${major}.${minor}.${patch}`;
}

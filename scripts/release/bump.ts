/**
 * Whether a commit range warrants a release. commit-and-tag-version would bump at least a patch for
 * *any* range (including chore/docs-only); this guard restores semantic-release's behaviour so that
 * a PR with no `feat`/`fix`/`perf` and no breaking change produces no version bump at all.
 *
 * A single commit is releasable when its conventional header type is `feat`, `fix`, or `perf`, when
 * the header carries a breaking-change `!` (`type!:` or `type(scope)!:`), or when its body has a
 * `BREAKING CHANGE:` / `BREAKING-CHANGE:` footer. The `chore(release): x.y.z` bump commit is a
 * `chore` and is therefore ignored, keeping reruns stable.
 */
const RELEASABLE_TYPES = new Set(['feat', 'fix', 'perf']);
const HEADER = /^(\w+)(?:\([^)]*\))?(!)?:/;
const BREAKING_FOOTER = /^BREAKING[ -]CHANGE:/m;

function isReleasable(message: string): boolean {
  const header = HEADER.exec(message);
  if (header !== null) {
    const [, type, bang] = header;
    if (bang === '!' || RELEASABLE_TYPES.has(type!)) return true;
  }
  return BREAKING_FOOTER.test(message);
}

export function hasReleasableCommits(messages: readonly string[]): boolean {
  return messages.some(isReleasable);
}

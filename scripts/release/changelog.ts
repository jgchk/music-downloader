/**
 * Extract one version's section body from a commit-and-tag-version CHANGELOG.md, for reuse as the
 * GitHub Release notes. A major bump renders as an `#` heading and minor/patch as `##`, both as
 * `[version](compare-url) (date)`; the section runs from just after its heading up to the next
 * version heading (or end of file). The leading heading line is dropped — the release title already
 * names the version. Throws when the version is absent so a misconfigured release fails loudly
 * rather than publishing empty notes.
 */
const VERSION_HEADING = /^#{1,2} \[?(\d+\.\d+\.\d+)/;

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function extractChangelogSection(changelog: string, version: string): string {
  const lines = changelog.split('\n');
  const heading = new RegExp(`^#{1,2} \\[?${escapeForRegExp(version)}(?:\\]|\\s|$)`);

  const start = lines.findIndex((line) => heading.test(line));
  if (start === -1) {
    throw new Error(`no CHANGELOG section found for version ${version}`);
  }

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (VERSION_HEADING.test(lines[i]!)) {
      end = i;
      break;
    }
  }

  return lines
    .slice(start + 1, end)
    .join('\n')
    .trim();
}

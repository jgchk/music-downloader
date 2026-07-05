import { readFileSync } from 'node:fs';
import { extractChangelogSection } from './changelog.ts';

/**
 * Print one version's CHANGELOG.md section to stdout, for the post-merge release job to pass to
 * `gh release create --notes-file`. Defaults to the current package.json version.
 *
 *   pnpm tsx scripts/release/changelog-section.ts [version] > notes.md
 */
const version =
  process.argv[2] ??
  (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version;

process.stdout.write(extractChangelogSection(readFileSync('CHANGELOG.md', 'utf8'), version));

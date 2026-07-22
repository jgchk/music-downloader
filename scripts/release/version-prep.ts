import { readFileSync, writeFileSync } from 'node:fs';
import { applyBump, bumpLevel } from './bump.ts';
import { latestReleaseVersion } from './tags.ts';
import { extractChangelogSection } from './changelog.ts';
import { detectReader, type ReleaseReader } from './reader.ts';
import { renderChangelogSection } from './render-changelog-section.ts';

/**
 * Pre-merge version preparation. Computes the next version and CHANGELOG section from the
 * conventional commits on this branch and either applies them to the working tree (write mode, for
 * the developer to commit into the PR) or verifies the branch already carries them (`--check`, the
 * required CI job — it never pushes).
 *
 * The computation is a pure function of (base state, range commits): both the next version and the
 * CHANGELOG section are rendered in memory (change: jj-native-version-prep — replacing the former
 * commit-and-tag-version + git-checkout dance), so the lifecycle runs identically over a plain git
 * checkout (CI) and a non-colocated jj workspace. package.json's version is anchored to the last
 * released *tag* and CHANGELOG.md is reset to its base content before the new section is prepended,
 * so a rerun produces the same result and the pipeline stays idempotent. The {@link bumpLevel} guard
 * suppresses catv's always-at-least-patch behaviour for chore/docs-only ranges (semantic-release
 * parity); the rendering reproduces catv 12.7.3 byte-for-byte.
 *
 *   pnpm version:prep            # apply the bump to the working tree
 *   pnpm version:prep --check    # CI: fail (with instructions) if the branch is not prepped
 */

const PKG = 'package.json';
const CHANGELOG = 'CHANGELOG.md';

// catv's CHANGELOG.md header + last-release marker, reproduced so write mode assembles the file
// exactly as catv did (lib/lifecycles/changelog.js).
const CHANGELOG_HEADER =
  '# Changelog\n\nAll notable changes to this project will be documented in this file. See [commit-and-tag-version](https://github.com/absolute-version/commit-and-tag-version) for commit guidelines.\n';
const START_OF_LAST_RELEASE = /(^#+ \[?[0-9]+\.[0-9]+\.[0-9]+|<a name=)/m;

function versionOf(packageJson: string): string {
  return (JSON.parse(packageJson) as { version: string }).version;
}

/** Reassemble CHANGELOG.md from its base content with `section` prepended — catv's exact logic. */
function assembleChangelog(baseChangelog: string, section: string): string {
  const frontMatter = baseChangelog.substring(0, baseChangelog.indexOf('# Changelog'));
  const bodyStart = baseChangelog.search(START_OF_LAST_RELEASE);
  const oldBody = bodyStart !== -1 ? baseChangelog.substring(bodyStart) : baseChangelog;
  return frontMatter + CHANGELOG_HEADER + '\n' + (section + oldBody).replace(/\n+$/, '\n');
}

interface Computed {
  version: string;
  bumped: boolean;
  /** The rendered CHANGELOG section (heading + body), present only when bumped. */
  section: string | null;
}

async function compute(reader: ReleaseReader): Promise<Computed> {
  // Anchor on the released mainline's tags, not `git describe` from HEAD: the merged importer
  // lineage carries its own v0.1.x tags at a competitive commit distance, and describe would pick by
  // distance. Released state is whatever main has shipped (tags.ts picks the highest semver).
  const lastVersion = latestReleaseVersion(reader.releaseTags());
  const commits = reader.rangeCommits(`v${lastVersion}`);
  const level = bumpLevel(commits.map((c) => c.message));

  if (level === null) {
    return { version: lastVersion, bumped: false, section: null };
  }

  const version = applyBump(lastVersion, level);
  const section = await renderChangelogSection(commits, { version, previousVersion: lastVersion });
  return { version, bumped: true, section };
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  const check = process.argv.includes('--check');
  const reader = detectReader();

  // Best-effort: CI checks out with full history/tags; locally the developer may already have them.
  reader.fetch();

  let computed: Computed;
  try {
    computed = await compute(reader);
  } catch (error) {
    fail(`version:prep: ${error instanceof Error ? error.message : String(error)}`);
  }
  const { version, bumped, section } = computed;

  if (!check) {
    // Write mode: apply the computed state to the working tree for the developer to commit. Anchor
    // package.json's version (preserving the branch's other package.json edits) and rebuild
    // CHANGELOG.md from its base content so the section is prepended exactly once.
    const pkg = readFileSync(PKG, 'utf8').replace(/("version":\s*)"[^"]*"/, `$1"${version}"`);
    writeFileSync(PKG, pkg);

    if (bumped && section !== null) {
      writeFileSync(CHANGELOG, assembleChangelog(reader.baseChangelog(), section));
      process.stdout.write(
        `version:prep: prepared ${version}. Review the diff, then commit ${PKG} and ${CHANGELOG}.\n`,
      );
    } else {
      writeFileSync(CHANGELOG, reader.baseChangelog());
      process.stdout.write(`version:prep: no releasable commits — staying at ${version}\n`);
    }
    return;
  }

  // --check: verify the committed tree already carries the computed state, entirely in memory (no
  // disk writes, no checkout/restore — the tree is never touched).
  const committedVersion = versionOf(reader.committedPackageJson());
  if (committedVersion !== version) {
    fail(
      `version:prep --check: expected version ${version} but ${PKG} has ${committedVersion}.\n` +
        `Run \`pnpm version:prep\` and commit ${PKG} and ${CHANGELOG}.`,
    );
  }

  if (bumped) {
    try {
      extractChangelogSection(reader.committedChangelog(), version);
    } catch {
      fail(
        `version:prep --check: ${CHANGELOG} has no section for ${version}.\n` +
          `Run \`pnpm version:prep\` and commit ${PKG} and ${CHANGELOG}.`,
      );
    }
  }

  process.stdout.write(`version:prep --check: branch is prepped for ${version}\n`);
}

void main().catch((error: unknown) => {
  fail(`version:prep: ${error instanceof Error ? error.message : String(error)}`);
});

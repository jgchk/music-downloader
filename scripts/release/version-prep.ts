import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { hasReleasableCommits } from './bump.ts';
import { latestReleaseVersion } from './tags.ts';
import { extractChangelogSection } from './changelog.ts';

/**
 * Pre-merge version preparation (change: overhaul-release-pipeline). Computes the next version and
 * CHANGELOG section from the conventional commits on this branch and either applies them to the
 * working tree (write mode, for the developer to commit into the PR) or verifies the branch already
 * carries them (`--check`, the required CI job — it never pushes).
 *
 * The computation is a pure function of (merge-base state, branch commits): package.json and
 * CHANGELOG.md are first reset to their merge-base content, so a second run produces the same
 * result and the pipeline stays idempotent. commit-and-tag-version renders the bump + changelog in
 * the repo's existing format; the {@link hasReleasableCommits} guard suppresses its always-at-least-
 * patch behaviour for chore/docs-only ranges (semantic-release parity).
 *
 *   pnpm version:prep            # apply the bump to the working tree
 *   pnpm version:prep --check    # CI: fail (with instructions) if the branch is not prepped
 */

const PKG = 'package.json';
const CHANGELOG = 'CHANGELOG.md';

function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

/** Contents of a path at a commit, or `''` when the file did not exist there. */
function fileAt(ref: string, path: string): string {
  try {
    return execFileSync('git', ['show', `${ref}:${path}`], { encoding: 'utf8' });
  } catch {
    return '';
  }
}

function versionOf(packageJson: string): string {
  return (JSON.parse(packageJson) as { version: string }).version;
}

async function computeExpected(base: string): Promise<{ version: string; bumped: boolean }> {
  // Anchor on the released mainline's tags, not `git describe` from HEAD: the merged importer
  // lineage carries its own v0.1.x tags at a competitive commit distance, and describe would pick
  // by distance. Released state is whatever main has shipped (tags.ts picks the highest semver).
  const mainlineTags = git(['tag', '-l', 'v*', '--merged', 'origin/main']).split('\n');
  const lastVersion = latestReleaseVersion(mainlineTags);
  const lastTag = `v${lastVersion}`;

  // Deterministic recompute. Anchor package.json's version to the last released *tag* — the true
  // source of released state — rather than the merge-base file, whose version can lag (on the
  // migration PR main's package.json is still 0.0.0). The anchor edits only the version field, so
  // the branch's other package.json changes (e.g. added deps) are preserved. CHANGELOG.md is reset
  // to its merge-base content so the new section is prepended exactly once. The git index is left
  // untouched, so a later `git checkout -- …` cleanly restores HEAD in check mode.
  const anchored = readFileSync(PKG, 'utf8').replace(
    /("version":\s*)"[^"]*"/,
    `$1"${lastVersion}"`,
  );
  writeFileSync(PKG, anchored);
  writeFileSync(CHANGELOG, fileAt(base, CHANGELOG));

  const log = git(['log', '--format=%B%x00', `${lastTag}..HEAD`]);
  const messages = log
    .split('\0')
    .map((m) => m.trim())
    .filter((m) => m.length > 0);

  if (!hasReleasableCommits(messages)) {
    return { version: lastVersion, bumped: false };
  }

  const catv = (await import('commit-and-tag-version')).default;
  await catv({ skip: { commit: true, tag: true }, silent: true });
  return { version: versionOf(readFileSync(PKG, 'utf8')), bumped: true };
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  const check = process.argv.includes('--check');

  // Best-effort: CI checks out with full history/tags; locally the developer may already have them.
  try {
    execFileSync('git', ['fetch', 'origin', 'main', '--tags'], { stdio: 'ignore' });
  } catch {
    /* offline or no remote — fall through to whatever refs exist locally */
  }

  let base: string;
  try {
    base = git(['merge-base', 'origin/main', 'HEAD']);
  } catch {
    fail('version:prep: cannot find a merge base with origin/main (fetch it and retry)');
  }

  const committedVersion = versionOf(fileAt('HEAD', PKG));
  const { version, bumped } = await computeExpected(base);

  if (!check) {
    if (!bumped) {
      process.stdout.write(`version:prep: no releasable commits — staying at ${version}\n`);
      return;
    }
    process.stdout.write(
      `version:prep: prepared ${version}. Review the diff, then commit ${PKG} and ${CHANGELOG}.\n`,
    );
    return;
  }

  // --check: verify the branch already carries the computed state, then leave the tree clean.
  git(['checkout', '--', PKG, CHANGELOG]);

  if (committedVersion !== version) {
    fail(
      `version:prep --check: expected version ${version} but ${PKG} has ${committedVersion}.\n` +
        `Run \`pnpm version:prep\` and commit ${PKG} and ${CHANGELOG}.`,
    );
  }

  if (bumped) {
    try {
      extractChangelogSection(fileAt('HEAD', CHANGELOG), version);
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

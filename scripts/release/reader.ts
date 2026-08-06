import { execFileSync } from 'node:child_process';
import type { RangeCommit } from './render-changelog-section.ts';

/**
 * The release lifecycle's read-only view of VCS state, abstracted over two backends so
 * `version:prep` runs both in CI — a plain `git` checkout where `jj` is not installed — and in a
 * non-colocated `jj` workspace, which has no `.git` and where git `HEAD` does not resolve (change:
 * jj-native-version-prep). The rendering and bump logic upstream is backend-agnostic; only these
 * inputs are gathered per backend.
 *
 * "committed" is the tree as it will be released: `HEAD` under git, the working-copy commit `@`
 * under jj. The "base" is the merge-base / fork point with the released mainline, from which
 * CHANGELOG.md is reset before a new section is prepended (idempotent reruns).
 */
export interface ReleaseReader {
  /** Best-effort refresh of remote refs + tags. Never throws (offline / no remote is fine). */
  fetch(): void;
  /** Release-tag names reachable on the released mainline, for `latestReleaseVersion`. */
  releaseTags(): string[];
  /** Commits in `<sinceTag>..committed`, each with full SHA and message. Order is irrelevant. */
  rangeCommits(sinceTag: string): RangeCommit[];
  /** CHANGELOG.md at the base (merge-base / fork point), or `''` when absent there. */
  baseChangelog(): string;
  /** package.json as committed on the released tree. */
  committedPackageJson(): string;
  /** CHANGELOG.md as committed on the released tree, or `''` when absent. */
  committedChangelog(): string;
}

/**
 * Split a `<hash>\x1f<message>\x00`-delimited log into range commits. Empty-message commits are
 * dropped: jj routinely has description-less commits (the working copy, abandoned-then-recreated
 * commits) that surface in a `tag..@` range as `<hash>\x1f` with no message — they carry no
 * changelog content and would otherwise crash the conventional-commits parser ("Expected a raw
 * commit"). This restores the old git-path `filter(m => m.length > 0)` behaviour for both backends.
 */
export function parseCommitLog(log: string): RangeCommit[] {
  return log
    .split('\0')
    .map((entry) => entry.replace(/^\n+/, ''))
    .filter((entry) => entry.trim().length > 0)
    .map((entry) => {
      const separator = entry.indexOf('\u{1F}');
      return { hash: entry.slice(0, separator).trim(), message: entry.slice(separator + 1).trim() };
    })
    .filter((commit) => commit.message.length > 0);
}

const PKG = 'package.json';
const CHANGELOG = 'CHANGELOG.md';

const git = (arguments_: string[]): string =>
  execFileSync('git', arguments_, { encoding: 'utf8' }).trim();

const jj = (arguments_: string[]): string => execFileSync('jj', arguments_, { encoding: 'utf8' });

/** Contents of a path at a git ref, or '' when the file did not exist there. */
const show = (reference: string, path: string): string => {
  try {
    return execFileSync('git', ['show', `${reference}:${path}`], { encoding: 'utf8' });
  } catch {
    return '';
  }
};

/** The merge-base this branch forked from — the anchor for the release range. */
const base = (): string => git(['merge-base', 'origin/main', 'HEAD']);

/** File content at a jj revision, or '' when the file did not exist there. */
const fileAt = (rev: string, path: string): string => {
  try {
    return jj(['file', 'show', '-r', rev, path]);
  } catch {
    return '';
  }
};

/** The CI / colocated backend: today's `git` calls, unchanged. */
export function gitReader(): ReleaseReader {
  return {
    fetch() {
      try {
        execFileSync('git', ['fetch', 'origin', 'main', '--tags'], { stdio: 'ignore' });
      } catch {
        /* offline or no remote — fall through to local refs */
      }
    },
    releaseTags() {
      return git(['tag', '-l', 'v*', '--merged', 'origin/main']).split('\n').filter(Boolean);
    },
    rangeCommits(sinceTag) {
      return parseCommitLog(git(['log', '--format=%H%x1f%B%x00', `${sinceTag}..HEAD`]));
    },
    baseChangelog() {
      return show(base(), CHANGELOG);
    },
    committedPackageJson() {
      return show('HEAD', PKG);
    },
    committedChangelog() {
      return show('HEAD', CHANGELOG);
    },
  };
}

/** The non-colocated jj-workspace backend: same inputs, sourced from `jj`. */
export function jjReader(): ReleaseReader {
  return {
    fetch() {
      try {
        execFileSync('jj', ['git', 'fetch'], { stdio: 'ignore' });
      } catch {
        /* offline or no git remote — fall through to local state */
      }
    },
    releaseTags() {
      // Each tagged commit reachable from the released mainline; `tags` renders its tag name(s).
      return jj([
        'log',
        '-r',
        'tags() & ::main@origin',
        '--no-graph',
        '-T',
        String.raw`tags ++ "\n"`,
      ])
        .split(/\s+/)
        .filter(Boolean);
    },
    rangeCommits(sinceTag) {
      // `@` is the working-copy commit — the tree that will be released, jj's analog of git HEAD.
      const log = jj([
        'log',
        '-r',
        `${sinceTag}..@`,
        '--no-graph',
        '-T',
        String.raw`commit_id ++ "\x1f" ++ description ++ "\x00"`,
      ]);
      return parseCommitLog(log);
    },
    baseChangelog() {
      return fileAt('fork_point(main@origin | @)', CHANGELOG);
    },
    committedPackageJson() {
      return fileAt('@', PKG);
    },
    committedChangelog() {
      return fileAt('@', CHANGELOG);
    },
  };
}

/**
 * Prefer jj when `jj root` succeeds (a jj repo is present); otherwise fall back to git. In CI the
 * `jj` binary is absent, so the probe throws ENOENT and the git backend is chosen — preserving the
 * existing `version-check` behaviour exactly.
 */
export function detectReader(): ReleaseReader {
  try {
    execFileSync('jj', ['root'], { stdio: 'ignore' });
    return jjReader();
  } catch {
    return gitReader();
  }
}

import { join } from 'node:path';
import { candidateKey } from '../../domain/candidate/candidate.js';
import type { CandidateIdentity } from '../../domain/candidate/candidate.js';
import type { Target } from '../../domain/target/target.js';

/**
 * Pure path rendering for the filesystem library adapter (D13): the naming *policy* (mechanism)
 * lives here so it is unit-testable in isolation, while the filesystem *operations* live in the
 * adapter. MVP policy = organize into `Artist/Release (Year)`; per-track renaming/tagging is a
 * deferred strategy (the user runs beets separately for now).
 */

// Path-hostile characters, whitespace, and control characters, each collapsed to an underscore.
const UNSAFE = /[\\/:*?"<>|\s\x00-\x1f]/g;

/** Reduce an arbitrary string to a single safe path segment; never empty. */
export function sanitizeSegment(raw: string): string {
  const cleaned = raw.replace(UNSAFE, '_').trim();
  return cleaned === '' ? '_' : cleaned;
}

/** Relative release directory for a target: `Artist/Title (Year)`, or `Artist/Title` without a year. */
export function renderReleaseDir(target: Target): string {
  const release = target.year !== undefined ? `${target.title} (${target.year})` : target.title;
  return join(sanitizeSegment(target.artist), sanitizeSegment(release));
}

/**
 * Where a candidate's files are staged before import — derived deterministically from the stable
 * candidate identity so the download adapter (which writes here) and the library adapter (which
 * imports from and cleans it) agree without threading paths through the domain.
 */
export function candidateStagingDir(stagingRoot: string, identity: CandidateIdentity): string {
  return join(stagingRoot, sanitizeSegment(candidateKey(identity)));
}

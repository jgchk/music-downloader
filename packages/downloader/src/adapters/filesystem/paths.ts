import path from 'node:path';
import type { Target } from '../../domain/target/target.js';

/**
 * Pure path rendering for the filesystem library adapter (D13): the naming *policy* (mechanism)
 * lives here so it is unit-testable in isolation, while the filesystem *operations* live in the
 * adapter. MVP policy = organize into `Artist/Release (Year)`; per-track renaming/tagging is a
 * deferred strategy (the user runs beets separately for now).
 */

// Path-hostile characters, whitespace, and control characters, each collapsed to an underscore.
const UNSAFE = /[\\/:*?"<>|\s\u{0}-\u{1F}]/gu;

/** Reduce an arbitrary string to a single safe path segment; never empty. */
export function sanitizeSegment(raw: string): string {
  const cleaned = raw.replaceAll(UNSAFE, '_').trim();
  return cleaned === '' ? '_' : cleaned;
}

/** Relative release directory for a target: `Artist/Title (Year)`, or `Artist/Title` without a year. */
export function renderReleaseDirectory(target: Target): string {
  const release = target.year === undefined ? target.title : `${target.title} (${target.year})`;
  return path.join(sanitizeSegment(target.artist), sanitizeSegment(release));
}

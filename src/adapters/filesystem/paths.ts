import { join } from 'node:path';
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

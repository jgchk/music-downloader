import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Target } from '../../domain/target/target.js';
import { candidateStagingDir, renderReleaseDir, sanitizeSegment } from './paths.js';

const target: Target = {
  type: 'album',
  artist: 'The Band',
  title: 'Great Album',
  tracks: [{ position: 1, title: 'One', durationMs: 1000 }],
  year: 2020,
};

describe('sanitizeSegment', () => {
  it('replaces filesystem-unsafe characters and spaces', () => {
    expect(sanitizeSegment('AC/DC: Live?')).toBe('AC_DC__Live_');
  });

  it('falls back to a placeholder for an empty string', () => {
    expect(sanitizeSegment('')).toBe('_');
  });
});

describe('renderReleaseDir', () => {
  it('includes the year when present', () => {
    expect(renderReleaseDir(target)).toBe(join('The_Band', 'Great_Album_(2020)'));
  });

  it('omits the year when absent', () => {
    expect(renderReleaseDir({ ...target, year: undefined })).toBe(join('The_Band', 'Great_Album'));
  });
});

describe('candidateStagingDir', () => {
  it('derives a single safe segment from the candidate identity', () => {
    const dir = candidateStagingDir('/staging', {
      username: 'peer',
      path: '/music/album',
      sizeBytes: 42,
    });
    expect(dir).toBe(join('/staging', 'peer__music_album_42'));
  });
});

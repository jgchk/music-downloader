import { describe, expect, it } from 'vitest';
import { baseName, mapSearchResponses, remoteFilename } from './mapping.js';

const richFile = {
  filename: '@@a\\Album\\01 Track.FLAC',
  size: 100,
  bitRate: 1000,
  sampleRate: 44100,
  bitDepth: 16,
  length: 200,
};
const sparseFile = { filename: '@@a\\Album\\02 Track.flac', size: 150 };

describe('mapSearchResponses', () => {
  it('returns nothing for an empty response list', () => {
    expect(mapSearchResponses([], 'album')).toEqual([]);
  });

  it('groups a release response into one folder candidate carrying every file', () => {
    const candidates = mapSearchResponses(
      [
        {
          username: 'u1',
          hasFreeUploadSlot: true,
          uploadSpeed: 5000,
          queueLength: 2,
          files: [richFile, sparseFile],
        },
      ],
      'album',
    );

    expect(candidates).toEqual([
      {
        identity: { username: 'u1', path: '@@a\\Album', sizeBytes: 250 },
        files: [
          {
            name: '01 Track.FLAC',
            sizeBytes: 100,
            codec: 'flac',
            bitrate: 1_000_000,
            sampleRate: 44100,
            bitDepth: 16,
            durationMs: 200_000,
          },
          {
            name: '02 Track.flac',
            sizeBytes: 150,
            codec: 'flac',
            bitrate: undefined,
            sampleRate: undefined,
            bitDepth: undefined,
            durationMs: undefined,
          },
        ],
        source: { speedBytesPerSec: 5000, freeSlots: 1, queueLength: 2 },
      },
    ]);
  });

  it('splits files across folders, folding sizeless/nameless files into the root group', () => {
    const candidates = mapSearchResponses(
      [{ files: [richFile, { filename: 'loose', size: 40 }, {}] }],
      'album',
    );

    expect(candidates).toEqual([
      {
        identity: { username: '', path: '@@a\\Album', sizeBytes: 100 },
        files: [expect.objectContaining({ name: '01 Track.FLAC' })],
        source: { speedBytesPerSec: 0, freeSlots: 0, queueLength: 0 },
      },
      {
        identity: { username: '', path: '', sizeBytes: 40 },
        files: [
          expect.objectContaining({ name: 'loose', codec: undefined }),
          expect.objectContaining({ name: '', sizeBytes: 0 }),
        ],
        source: { speedBytesPerSec: 0, freeSlots: 0, queueLength: 0 },
      },
    ]);
  });

  it('ignores a response that advertises no files', () => {
    expect(mapSearchResponses([{ username: 'u3' }], 'album')).toEqual([]);
  });

  it('yields one candidate per file for a track target', () => {
    const candidates = mapSearchResponses([{ username: 'u1', files: [richFile, {}] }], 'track');

    expect(candidates).toEqual([
      {
        identity: { username: 'u1', path: '@@a\\Album\\01 Track.FLAC', sizeBytes: 100 },
        files: [expect.objectContaining({ name: '01 Track.FLAC' })],
        source: { speedBytesPerSec: 0, freeSlots: 0, queueLength: 0 },
      },
      {
        identity: { username: 'u1', path: '', sizeBytes: 0 },
        files: [expect.objectContaining({ name: '', sizeBytes: 0 })],
        source: { speedBytesPerSec: 0, freeSlots: 0, queueLength: 0 },
      },
    ]);
  });
});

describe('baseName', () => {
  it('takes the segment after the last separator', () => {
    expect(baseName('@@a\\Album\\01.flac')).toBe('01.flac');
    expect(baseName('bare.mp3')).toBe('bare.mp3');
  });
});

describe('remoteFilename', () => {
  it('uses a track candidate path verbatim', () => {
    expect(remoteFilename('@@a\\Album\\01.flac', '01.flac')).toBe('@@a\\Album\\01.flac');
  });

  it('re-appends a file to a folder candidate path', () => {
    expect(remoteFilename('@@a\\Album', '01.flac')).toBe('@@a\\Album\\01.flac');
  });
});

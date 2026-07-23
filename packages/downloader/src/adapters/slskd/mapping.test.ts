import { describe, expect, it } from 'vitest';
import { asCandidateIdentity } from '../../domain/shared/__fixtures__/candidate-identity.js';
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

  it('splits files across folders, dropping the rootless group with no addressable path', () => {
    // `loose` and the nameless file fold into the root group (path ''); an empty path yields no
    // sound dedup key, so `parseCandidateIdentity` rejects that group and the ACL drops it. The
    // kept folder also carries `notes` (no extension, no advertised size) to exercise the file
    // mapping's codec/size fallbacks.
    const candidates = mapSearchResponses(
      [
        {
          username: 'u2',
          files: [richFile, { filename: '@@a\\Album\\notes' }, { filename: 'loose', size: 40 }, {}],
        },
      ],
      'album',
    );

    expect(candidates).toEqual([
      {
        identity: asCandidateIdentity({ username: 'u2', path: '@@a\\Album', sizeBytes: 100 }),
        files: [
          expect.objectContaining({ name: '01 Track.FLAC' }),
          expect.objectContaining({ name: 'notes', codec: undefined, sizeBytes: 0 }),
        ],
        source: { speedBytesPerSec: 0, freeSlots: 0, queueLength: 0 },
      },
    ]);
  });

  it('ignores a response that advertises neither a username nor any files', () => {
    expect(mapSearchResponses([{}], 'album')).toEqual([]);
  });

  it('yields one candidate per file for a track target, dropping a nameless (pathless) file', () => {
    const candidates = mapSearchResponses([{ username: 'u1', files: [richFile, {}] }], 'track');

    expect(candidates).toEqual([
      {
        identity: asCandidateIdentity({
          username: 'u1',
          path: '@@a\\Album\\01 Track.FLAC',
          sizeBytes: 100,
        }),
        files: [expect.objectContaining({ name: '01 Track.FLAC' })],
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

import { describe, expect, it } from 'vitest';
import {
  slskdSearchResponsesSchema,
  slskdSearchStateSchema,
  slskdTransfersSchema,
} from './schemas.js';

describe('slskd contract schemas', () => {
  it('accepts a search state and tolerates a bare create response', () => {
    expect(slskdSearchStateSchema.parse({ id: 's1', isComplete: true })).toEqual({
      id: 's1',
      isComplete: true,
    });
    expect(slskdSearchStateSchema.parse({})).toEqual({});
  });

  it('rejects a search state whose isComplete is not a boolean', () => {
    expect(slskdSearchStateSchema.safeParse({ isComplete: 'yes' }).success).toBe(false);
  });

  it('accepts search responses with all consumed file attributes, stripping unknown fields', () => {
    const parsed = slskdSearchResponsesSchema.parse([
      {
        username: 'peer1',
        hasFreeUploadSlot: true,
        uploadSpeed: 5000000,
        queueLength: 0,
        lockedFileCount: 3, // unknown to the contract
        files: [
          {
            filename: 'a.flac',
            size: 100,
            bitRate: 900,
            sampleRate: 44100,
            bitDepth: 16,
            length: 10,
          },
        ],
      },
    ]);

    expect(parsed[0]).not.toHaveProperty('lockedFileCount');
    expect(parsed[0]?.files?.[0]?.bitRate).toBe(900);
  });

  it('rejects a responses payload that is not an array, reporting the failure', () => {
    const result = slskdSearchResponsesSchema.safeParse({ not: 'an array' });

    expect(result.success).toBe(false);
  });

  it('rejects a search file whose size is not a number', () => {
    expect(
      slskdSearchResponsesSchema.safeParse([{ files: [{ filename: 'a', size: '100' }] }]).success,
    ).toBe(false);
  });

  it('accepts the user-object transfers payload grouped by directory', () => {
    const parsed = slskdTransfersSchema.parse({
      username: 'peer1', // unknown to the contract (stripped)
      directories: [
        {
          directory: 'd', // unknown to the contract (stripped)
          files: [{ id: 't1', filename: 'a.flac', state: 'InProgress, Transferring', size: 100 }],
        },
      ],
    });

    expect(parsed).not.toHaveProperty('username');
    expect(parsed.directories?.[0]).not.toHaveProperty('directory');
    expect(parsed.directories?.[0]?.files?.[0]?.id).toBe('t1');
  });

  it('rejects a transfers payload whose directories is not an array', () => {
    expect(slskdTransfersSchema.safeParse({ directories: 'nope' }).success).toBe(false);
  });

  it('rejects a transfer whose state is not a string, reporting the path', () => {
    const result = slskdTransfersSchema.safeParse({ directories: [{ files: [{ state: 5 }] }] });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['directories', 0, 'files', 0, 'state']);
  });
});

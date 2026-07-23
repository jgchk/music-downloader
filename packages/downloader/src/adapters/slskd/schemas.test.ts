import { describe, expect, it } from 'vitest';
import {
  slskdDownloadFileCompleteSchema,
  slskdEventsSchema,
  slskdOptionsSchema,
  slskdSearchResponsesSchema,
  slskdSearchStateSchema,
  slskdTransfersSchema,
} from './schemas.js';

describe('slskd contract schemas', () => {
  it('accepts a fully-populated search state', () => {
    expect(
      slskdSearchStateSchema.parse({
        id: 's1',
        isComplete: true,
        state: 'Completed, TimedOut',
        responseCount: 180,
      }),
    ).toEqual({ id: 's1', isComplete: true, state: 'Completed, TimedOut', responseCount: 180 });
  });

  it('tolerates a bare create response', () => {
    expect(slskdSearchStateSchema.parse({})).toEqual({});
  });

  it('rejects a search state whose isComplete is not a boolean', () => {
    expect(slskdSearchStateSchema.safeParse({ isComplete: 'yes' }).success).toBe(false);
  });

  it('rejects a search state whose state is not a string', () => {
    expect(slskdSearchStateSchema.safeParse({ state: 42 }).success).toBe(false);
  });

  it('rejects a search state whose responseCount is not a number', () => {
    expect(slskdSearchStateSchema.safeParse({ responseCount: 'many' }).success).toBe(false);
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

  it('accepts an events log, keeping data as an opaque string and stripping unknown record fields', () => {
    const parsed = slskdEventsSchema.parse([
      {
        type: 'DownloadFileComplete',
        data: '{"localFilename":"/app/downloads/a/1.mp3"}',
        timestamp: '2026-07-17T00:00:00Z',
        id: 'evt-1',
        globalId: 825, // unknown to the contract (stripped)
      },
    ]);

    expect(parsed[0]?.data).toBe('{"localFilename":"/app/downloads/a/1.mp3"}');
    expect(parsed[0]).not.toHaveProperty('globalId');
  });

  it('rejects an event record missing its consumed type or data field', () => {
    expect(slskdEventsSchema.safeParse([{ type: 'DownloadFileComplete' }]).success).toBe(false);
    expect(slskdEventsSchema.safeParse([{ data: '{}' }]).success).toBe(false);
  });

  it('decodes a DownloadFileComplete payload, stripping unknown fields', () => {
    const parsed = slskdDownloadFileCompleteSchema.parse({
      localFilename: '/app/downloads/2007 - Alive/13 Human.mp3',
      remoteFilename: '@@x\\Alive\\13 Human.mp3',
      transfer: { id: '2f3b3fd5', state: 'Completed, Succeeded' }, // extra transfer field stripped
      state: 'Completed', // unknown to the contract (stripped)
    });

    expect(parsed.localFilename).toBe('/app/downloads/2007 - Alive/13 Human.mp3');
    expect(parsed.transfer.id).toBe('2f3b3fd5');
    expect(parsed).not.toHaveProperty('state');
  });

  it('rejects a DownloadFileComplete payload missing localFilename or the transfer id', () => {
    expect(slskdDownloadFileCompleteSchema.safeParse({ transfer: { id: 't1' } }).success).toBe(
      false,
    );
    expect(
      slskdDownloadFileCompleteSchema.safeParse({ localFilename: '/a', transfer: {} }).success,
    ).toBe(false);
  });

  it('accepts an options payload, reading the downloads root and stripping unknown fields', () => {
    const parsed = slskdOptionsSchema.parse({
      directories: { downloads: '/app/downloads', incomplete: '/app/incomplete' },
      soulseek: { username: 'x' }, // unknown to the contract (stripped)
    });

    expect(parsed.directories.downloads).toBe('/app/downloads');
    expect(parsed).not.toHaveProperty('soulseek');
  });

  it('rejects an options payload whose downloads root is missing or not a string', () => {
    expect(slskdOptionsSchema.safeParse({ directories: {} }).success).toBe(false);
    expect(slskdOptionsSchema.safeParse({ directories: { downloads: 5 } }).success).toBe(false);
  });
});

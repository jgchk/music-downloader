import { describe, expect, it } from 'vitest';
import {
  mbRecordingSchema,
  mbRecordingSearchSchema,
  mbReleaseSchema,
  mbReleaseSearchSchema,
} from './schemas.js';

describe('MusicBrainz contract schemas', () => {
  it('accepts a release carrying every consumed field', () => {
    const parsed = mbReleaseSchema.parse({
      id: 'rel-1',
      title: 'Album',
      date: '2021-05-01',
      'artist-credit': [{ name: 'Artist', joinphrase: ' & ' }],
      media: [{ tracks: [{ position: 1, title: 'T1', length: 1000, recording: { title: 'T1' } }] }],
    });

    expect(parsed.media?.[0]?.tracks?.[0]?.length).toBe(1000);
  });

  it('tolerates unknown fields (additive provider changes are not drift)', () => {
    const parsed = mbReleaseSchema.parse({
      id: 'rel-1',
      title: 'Album',
      packaging: 'Jewel Case', // unknown to the contract
      'artist-credit': [{ name: 'Artist', type: 'Group' }],
    });

    expect(parsed).toMatchObject({ id: 'rel-1', title: 'Album' });
    expect(parsed).not.toHaveProperty('packaging');
  });

  it('rejects a release whose consumed field is retyped, reporting the path', () => {
    const result = mbReleaseSchema.safeParse({ id: 'rel-1', media: 'not-an-array' });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['media']);
  });

  it('accepts a recording carrying every consumed field', () => {
    const parsed = mbRecordingSchema.parse({
      id: 'rec-1',
      title: 'Song',
      length: 200000,
      'artist-credit': [{ name: 'Artist' }],
    });

    expect(parsed.length).toBe(200000);
  });

  it('rejects a recording whose length is not a number', () => {
    expect(mbRecordingSchema.safeParse({ id: 'rec-1', length: '200000' }).success).toBe(false);
  });

  it('accepts scored search hit lists and tolerates an absent list', () => {
    expect(
      mbReleaseSearchSchema.parse({ releases: [{ id: 'rel-2', score: 95 }] }).releases,
    ).toEqual([{ id: 'rel-2', score: 95 }]);
    expect(mbRecordingSearchSchema.parse({}).recordings).toBeUndefined();
  });

  it('rejects a search hit whose score is not a number', () => {
    expect(
      mbReleaseSearchSchema.safeParse({ releases: [{ id: 'x', score: 'high' }] }).success,
    ).toBe(false);
  });
});

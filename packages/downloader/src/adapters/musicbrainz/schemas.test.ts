import { describe, expect, it } from 'vitest';
import {
  mbRecordingSchema,
  mbRecordingSearchSchema,
  mbReleaseGroupBrowseSchema,
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

  it('accepts a null track length (MusicBrainz reports unknown durations as null)', () => {
    const parsed = mbReleaseSchema.parse({
      id: 'rel-1',
      title: 'Album',
      'artist-credit': [{ name: 'Artist' }],
      media: [
        { tracks: [{ position: 1, title: 'T1', length: null, recording: { length: null } }] },
      ],
    });

    expect(parsed.media?.[0]?.tracks?.[0]?.length).toBeNull();
  });

  it('accepts a null recording length', () => {
    expect(mbRecordingSchema.parse({ id: 'rec-1', title: 'Song', length: null }).length).toBeNull();
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

  it('consumes the release-search identity and edition fields when present', () => {
    const [hit] = mbReleaseSearchSchema.parse({
      releases: [
        {
          id: 'rel-2',
          score: 100,
          title: 'Album (Deluxe Edition)',
          status: 'Official',
          date: '2016-11-04',
          'release-group': { id: 'rg-1', title: 'Album', 'primary-type': 'Album' }, // primary-type unknown to the contract
        },
      ],
    }).releases!;

    expect(hit).toEqual({
      id: 'rel-2',
      score: 100,
      title: 'Album (Deluxe Edition)',
      status: 'Official',
      date: '2016-11-04',
      'release-group': { id: 'rg-1', title: 'Album' },
    });
  });

  it('tolerates release-search hits missing the identity and edition fields', () => {
    expect(
      mbReleaseSearchSchema.parse({ releases: [{ id: 'rel-2', score: 95 }] }).releases,
    ).toEqual([{ id: 'rel-2', score: 95 }]);
  });

  it('rejects a search hit whose score is not a number', () => {
    expect(
      mbReleaseSearchSchema.safeParse({ releases: [{ id: 'x', score: 'high' }] }).success,
    ).toBe(false);
  });

  it('rejects a release-search hit whose release-group id is retyped', () => {
    const result = mbReleaseSearchSchema.safeParse({
      releases: [{ id: 'x', score: 100, 'release-group': { id: 42 } }],
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['releases', 0, 'release-group', 'id']);
  });

  it('accepts a release-group browse carrying every consumed edition field', () => {
    const parsed = mbReleaseGroupBrowseSchema.parse({
      releases: [
        {
          id: 'rel-1',
          title: 'Album',
          status: 'Official',
          date: '2014-10-27',
          media: [{ 'track-count': 8 }, { 'track-count': 5 }],
        },
      ],
    });

    expect(parsed.releases?.[0]?.media?.map((m) => m['track-count'])).toEqual([8, 5]);
  });

  it('tolerates a browse edition missing status, date, and media', () => {
    expect(mbReleaseGroupBrowseSchema.parse({ releases: [{ id: 'rel-1' }] }).releases).toEqual([
      { id: 'rel-1' },
    ]);
  });

  it('rejects a browse edition whose media track-count is not a number', () => {
    const result = mbReleaseGroupBrowseSchema.safeParse({
      releases: [{ id: 'x', media: [{ 'track-count': 'ten' }] }],
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['releases', 0, 'media', 0, 'track-count']);
  });

  it('consumes the browse edition country and media format for candidate presentation', () => {
    const parsed = mbReleaseGroupBrowseSchema.parse({
      releases: [
        {
          id: 'rel-1',
          title: 'Album',
          status: 'Bootleg',
          date: '1995-05-01',
          country: 'GB',
          media: [{ 'track-count': 12, format: 'CD' }],
        },
      ],
    });

    expect(parsed.releases?.[0]?.country).toBe('GB');
    expect(parsed.releases?.[0]?.media?.[0]?.format).toBe('CD');
  });

  it('accepts a null browse country and media format (MusicBrainz reports unknowns as null)', () => {
    const parsed = mbReleaseGroupBrowseSchema.parse({
      releases: [{ id: 'rel-1', country: null, media: [{ 'track-count': 12, format: null }] }],
    });

    expect(parsed.releases?.[0]?.country).toBeNull();
    expect(parsed.releases?.[0]?.media?.[0]?.format).toBeNull();
  });

  it('rejects a browse edition whose media format is not a string', () => {
    const result = mbReleaseGroupBrowseSchema.safeParse({
      releases: [{ id: 'x', media: [{ format: 7 }] }],
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['releases', 0, 'media', 0, 'format']);
  });
});

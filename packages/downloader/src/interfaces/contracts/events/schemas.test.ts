import { describe, expect, it } from 'vitest';
import {
  ACQUISITION_FULFILLED_TYPE,
  acquisitionFulfilledDataSchema,
  acquisitionFulfilledEventSchema,
} from './schemas.js';

const data = {
  acquisitionId: 'acq-1',
  target: {
    type: 'album',
    artist: 'Radiohead',
    title: 'Kid A',
    musicbrainzReleaseId: 'mbid-1',
    year: 2000,
    trackCount: 2,
  },
  candidate: { username: 'peer', path: String.raw`peer\music\kid-a`, sizeBytes: 1000 },
  location: '/library/Radiohead/Kid A (2000)',
  files: [{ name: '01.flac', path: '/library/Radiohead/Kid A (2000)/01.flac' }],
};

const envelope = {
  type: 'acquisition.fulfilled',
  timestamp: '2026-07-03T12:00:00.000Z',
  data,
};

describe('acquisitionFulfilledDataSchema', () => {
  it('accepts a complete payload and round-trips it unchanged', () => {
    const parsed = acquisitionFulfilledDataSchema.parse(data);
    expect(parsed).toEqual(data);
  });

  it('fills absent optional target fields with explicit null defaults (the contract, not the reader, decides)', () => {
    const { musicbrainzReleaseId: _mb, year: _y, ...bareTarget } = data.target;
    const parsed = acquisitionFulfilledDataSchema.parse({ ...data, target: bareTarget });
    expect(parsed.target.musicbrainzReleaseId).toBeNull();
    expect(parsed.target.year).toBeNull();
  });

  it('rejects a payload missing its acquisition id', () => {
    const { acquisitionId: _id, ...rest } = data;
    expect(acquisitionFulfilledDataSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects an empty deposited location', () => {
    expect(acquisitionFulfilledDataSchema.safeParse({ ...data, location: '' }).success).toBe(false);
  });

  it('rejects a file entry without a name', () => {
    const broken = { ...data, files: [{ path: '/library/x' }] };
    expect(acquisitionFulfilledDataSchema.safeParse(broken).success).toBe(false);
  });
});

describe('acquisitionFulfilledEventSchema', () => {
  it('accepts the {type, timestamp, data} envelope', () => {
    const parsed = acquisitionFulfilledEventSchema.parse(envelope);
    expect(parsed.type).toBe(ACQUISITION_FULFILLED_TYPE);
    expect(parsed.timestamp).toBe('2026-07-03T12:00:00.000Z');
    expect(parsed.data).toEqual(data);
  });

  it('rejects a foreign event type literal', () => {
    const result = acquisitionFulfilledEventSchema.safeParse({ ...envelope, type: 'other.event' });
    expect(result.success).toBe(false);
  });

  it('rejects a non-ISO-8601 timestamp', () => {
    const result = acquisitionFulfilledEventSchema.safeParse({ ...envelope, timestamp: 'today' });
    expect(result.success).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { editionSummary, pickedMbid, trackTime } from './detail.js';
import type { CatalogEditionsResultDto } from '@music/downloader';

const MBID = '1b022e01-4da6-387b-8658-8678046e4cef';

const edition = (overrides: Record<string, unknown> = {}) => ({
  mbid: MBID,
  title: 'Graceland',
  formats: 'CD',
  trackCount: 11,
  date: '1986-08-29',
  country: 'DE',
  ...overrides,
});

describe('editionSummary', () => {
  it('says what tells one pressing from another', () => {
    expect(editionSummary(edition())).toBe('1986-08-29 · DE · CD · 11 tracks');
  });

  it('leaves out what the catalog does not know, without leaving a gap', () => {
    expect(editionSummary(edition({ date: undefined, country: undefined }))).toBe('CD · 11 tracks');
  });

  it('counts one track as one track', () => {
    expect(editionSummary(edition({ trackCount: 1 }))).toContain('1 track');
  });

  it('says nothing about a format the catalog does not name', () => {
    expect(editionSummary(edition({ formats: '' }))).toBe('1986-08-29 · DE · 11 tracks');
  });
});

describe('pickedMbid', () => {
  it('names the edition the pipeline would choose', () => {
    const editions: CatalogEditionsResultDto = {
      groups: [],
      bestMatch: { kind: 'pick', mbid: MBID },
    };

    expect(pickedMbid(editions)).toBe(MBID);
  });

  it('names none when the pipeline would ask instead of choosing', () => {
    const editions: CatalogEditionsResultDto = {
      groups: [],
      bestMatch: { kind: 'selection-required' },
    };

    expect(pickedMbid(editions)).toBeUndefined();
  });
});

describe('trackTime', () => {
  it('renders a running time the way a sleeve does', () => {
    expect(trackTime(239_000)).toBe('3:59');
    expect(trackTime(61_000)).toBe('1:01');
  });

  it('says nothing for a track the catalog has no timing for', () => {
    expect(trackTime(undefined)).toBe('');
  });
});

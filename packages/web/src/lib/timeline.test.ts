import { describe, expect, it } from 'vitest';
import { mergeTimeline } from './timeline.js';
import type { DownloaderHistoryEntry, ImporterHistoryEntry } from './timeline.js';

/** A downloader `selected` entry; `path` distinguishes otherwise-identical entries. */
function sel(at: string, path = '/files/a.flac'): DownloaderHistoryEntry {
  return { kind: 'selected', at, candidate: { username: 'u', path, sizeBytes: 9 } };
}

function handoff(at: string): DownloaderHistoryEntry {
  return {
    kind: 'imported',
    at,
    candidate: { username: 'u', path: 'p', sizeBytes: 1 },
    location: '/stage/x',
  };
}

function request(at: string): ImporterHistoryEntry {
  return { kind: 'requested', at };
}

function rejected(at: string): ImporterHistoryEntry {
  return { kind: 'rejected', at, reason: 'corrupt rip', filesDeleted: true };
}

describe('mergeTimeline', () => {
  it('orders both modules by occurrence time, preserving each entry with its module', () => {
    const merged = mergeTimeline(
      [sel('2026-01-01T00:00:00Z', '/a'), sel('2026-01-01T00:00:05Z', '/b')],
      [request('2026-01-01T00:00:02Z'), request('2026-01-01T00:00:09Z')],
    );
    // Full-entry equality pins both the order and that each payload survives the merge intact.
    expect(merged).toEqual([
      {
        module: 'downloader',
        at: '2026-01-01T00:00:00Z',
        entry: sel('2026-01-01T00:00:00Z', '/a'),
      },
      { module: 'importer', at: '2026-01-01T00:00:02Z', entry: request('2026-01-01T00:00:02Z') },
      {
        module: 'downloader',
        at: '2026-01-01T00:00:05Z',
        entry: sel('2026-01-01T00:00:05Z', '/b'),
      },
      { module: 'importer', at: '2026-01-01T00:00:09Z', entry: request('2026-01-01T00:00:09Z') },
    ]);
  });

  it('interleaves an import rejection between the downloader hand-off and its revival', () => {
    // The importer's requested+rejected straddle the downloader's hand-off and its retry, so a
    // by-module concatenation would wrongly block them apart.
    const merged = mergeTimeline(
      [sel('2026-01-01T00:00:00Z'), handoff('2026-01-01T00:00:02Z'), sel('2026-01-01T00:00:07Z')],
      [request('2026-01-01T00:00:03Z'), rejected('2026-01-01T00:00:06Z')],
    );
    expect(merged.map((t) => [t.module, t.entry.kind])).toEqual([
      ['downloader', 'selected'],
      ['downloader', 'imported'],
      ['importer', 'requested'],
      ['importer', 'rejected'],
      ['downloader', 'selected'],
    ]);
  });

  it('breaks a timestamp tie with the downloader first, then keeps each module log order', () => {
    const merged = mergeTimeline(
      [sel('2026-01-01T00:00:00Z', '/first'), sel('2026-01-01T00:00:00Z', '/second')],
      [request('2026-01-01T00:00:00Z')],
    );
    expect(merged.map((t) => t.module)).toEqual(['downloader', 'downloader', 'importer']);
    // Refutable log-order: the two same-time downloader entries keep their input order.
    const paths = merged
      .filter((t) => t.module === 'downloader')
      .map((t) => (t.entry.kind === 'selected' ? t.entry.candidate.path : ''));
    expect(paths).toEqual(['/first', '/second']);
  });

  it('returns the downloader-only timeline when there is no import', () => {
    const merged = mergeTimeline([sel('2026-01-01T00:00:00Z')], []);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.module).toBe('downloader');
  });
});

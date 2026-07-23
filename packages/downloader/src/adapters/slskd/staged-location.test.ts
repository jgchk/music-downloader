import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SlskdEventRecord } from './schemas.js';
import { resolveStagedPaths } from './staged-location.js';

const ROOT = '/app/downloads';
const STAGING = '/staging';

function completeEvent(id: string, localFilename: string): SlskdEventRecord {
  return {
    type: 'DownloadFileComplete',
    data: JSON.stringify({ localFilename, transfer: { id } }),
  };
}

describe('resolveStagedPaths', () => {
  it('maps a completed transfer onto the staging volume, correlated by transfer id', () => {
    const resolved = resolveStagedPaths(
      new Set(['t1']),
      [completeEvent('t1', '/app/downloads/Test Album/01 Track One.flac')],
      ROOT,
      STAGING,
    );

    expect(resolved.get('t1')).toBe(path.join(STAGING, 'Test Album', '01 Track One.flac'));
  });

  it('reports the source-renamed on-disk name, not the originally requested one', () => {
    // slskd sanitized/collision-suffixed the file; the event carries the real on-disk name.
    const resolved = resolveStagedPaths(
      new Set(['t1']),
      [completeEvent('t1', '/app/downloads/Album/01_123456.flac')],
      ROOT,
      STAGING,
    );

    expect(resolved.get('t1')).toBe(path.join(STAGING, 'Album', '01_123456.flac'));
  });

  it('resolves only the wanted ids, ignoring other event types and unrelated completions', () => {
    const resolved = resolveStagedPaths(
      new Set(['t1']),
      [
        { type: 'DownloadStarted', data: '{}' }, // a different event type — skipped
        completeEvent('other', '/app/downloads/Someone Else/x.flac'), // not ours — skipped
        completeEvent('t1', '/app/downloads/Album/01.flac'),
      ],
      ROOT,
      STAGING,
    );

    expect(resolved.keys().toArray()).toEqual(['t1']);
    expect(resolved.get('t1')).toBe(path.join(STAGING, 'Album', '01.flac'));
  });

  it('returns a partial map when the page is missing some of our ids', () => {
    const resolved = resolveStagedPaths(
      new Set(['t1', 't2']),
      [completeEvent('t1', '/app/downloads/Album/01.flac')],
      ROOT,
      STAGING,
    );

    expect(resolved.has('t1')).toBe(true);
    expect(resolved.has('t2')).toBe(false);
  });
});

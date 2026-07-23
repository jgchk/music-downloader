import { describe, expect, it } from 'vitest';
import type { AcquisitionStatusResponseDto } from '@music/downloader';
import {
  formatBytes,
  isCancellable,
  isTerminal,
  outcomeSummary,
  parseAcquisitionView,
  statusTone,
  targetDescription,
} from './acquisitions.js';

function acquisition(over: Partial<AcquisitionStatusResponseDto>): AcquisitionStatusResponseDto {
  return {
    acquisitionId: 'acq-1',
    status: 'Searching',
    attempts: 0,
    rejectedCount: 0,
    history: [],
    ...over,
  };
}

describe('statusTone / isTerminal / isCancellable', () => {
  it.each([
    ['Empty', 'pending', false],
    ['Pending', 'pending', false],
    ['AwaitingManualSelection', 'attention', false],
    ['Searching', 'pending', false],
    ['Selecting', 'pending', false],
    ['Downloading', 'pending', false],
    ['Validating', 'pending', false],
    ['Importing', 'pending', false],
    ['Fulfilled', 'fulfilled', true],
    ['Exhausted', 'failed', true],
    ['Cancelled', 'failed', true],
    ['MetadataFailed', 'failed', true],
    ['Conflicted', 'failed', true],
  ] as const)('%s -> %s (terminal: %s)', (status, tone, terminal) => {
    expect(statusTone(status)).toBe(tone);
    expect(isTerminal(status)).toBe(terminal);
    expect(isCancellable(status)).toBe(!terminal);
  });
});

describe('targetDescription', () => {
  it('renders artist — title when resolved', () => {
    expect(targetDescription(acquisition({ target: { artist: 'A', title: 'T' } }))).toBe('A — T');
  });

  it('renders a resolving placeholder before a target is known', () => {
    expect(targetDescription(acquisition({}))).toBe('(resolving…)');
  });

  it('names the awaited edition choice after the offered editions, never "(resolving…)"', () => {
    expect(
      targetDescription(
        acquisition({
          status: 'AwaitingManualSelection',
          candidates: [
            { releaseMbid: 'r1', trackCount: 10 },
            { releaseMbid: 'r2', title: 'OK Computer', trackCount: 12 },
          ],
        }),
      ),
    ).toBe('OK Computer — awaiting your edition choice');
  });

  it('states the awaited choice even when no offered edition carries a title', () => {
    expect(
      targetDescription(
        acquisition({
          status: 'AwaitingManualSelection',
          candidates: [{ releaseMbid: 'r1', trackCount: 10 }],
        }),
      ),
    ).toBe('Awaiting your edition choice');
  });

  it('states the awaited choice when the projection carries no candidates at all', () => {
    expect(targetDescription(acquisition({ status: 'AwaitingManualSelection' }))).toBe(
      'Awaiting your edition choice',
    );
  });

  it('prefers a resolved target over the awaiting description', () => {
    expect(
      targetDescription(
        acquisition({ status: 'AwaitingManualSelection', target: { artist: 'A', title: 'T' } }),
      ),
    ).toBe('A — T');
  });
});

describe('outcomeSummary', () => {
  it('is undefined while working', () => {
    expect(outcomeSummary(acquisition({ status: 'Searching' }))).toBeUndefined();
  });

  it('reports the deposit location when fulfilled', () => {
    expect(outcomeSummary(acquisition({ status: 'Fulfilled', location: '/lib/x' }))).toBe('/lib/x');
  });

  it('falls back to the bare status when fulfilled without a location', () => {
    expect(outcomeSummary(acquisition({ status: 'Fulfilled' }))).toBe('Fulfilled');
  });

  it('collects deduped failure reasons for a failed terminal state', () => {
    const candidate = { username: 'u', path: 'p', sizeBytes: 1 };
    expect(
      outcomeSummary(
        acquisition({
          status: 'Exhausted',
          history: [
            { kind: 'selected', at: 't', candidate },
            { kind: 'download-failed', at: 't', candidate, reason: 'Stalled' },
            { kind: 'validation-failed', at: 't', candidate, reasons: ['DurationMismatch'] },
            { kind: 'download-failed', at: 't', candidate, reason: 'Stalled' },
            { kind: 'fulfillment-rejected', at: 't', candidate, reasons: ['bad rip'] },
            { kind: 'imported', at: 't', candidate, location: '/x' },
          ],
        }),
      ),
    ).toBe('Exhausted (Stalled, DurationMismatch, bad rip)');
  });

  it('renders a failed terminal state without reasons plainly', () => {
    expect(outcomeSummary(acquisition({ status: 'Cancelled' }))).toBe('Cancelled');
  });
});

describe('parseAcquisitionView', () => {
  it('lifts awaiting-selection with candidates into an editions view that carries them', () => {
    const candidates = [{ releaseMbid: 'r1', title: 'OK Computer', trackCount: 12 }];
    expect(
      parseAcquisitionView(acquisition({ status: 'AwaitingManualSelection', candidates })),
    ).toEqual({ kind: 'editions', candidates });
  });

  it('lifts awaiting-selection without candidates into the no-editions degradation', () => {
    expect(parseAcquisitionView(acquisition({ status: 'AwaitingManualSelection' }))).toEqual({
      kind: 'no-editions',
    });
  });

  it('is not-awaiting for any other status, even one carrying candidates', () => {
    expect(
      parseAcquisitionView(
        acquisition({ status: 'Downloading', candidates: [{ releaseMbid: 'r1' }] }),
      ),
    ).toEqual({ kind: 'not-awaiting' });
  });
});

describe('formatBytes', () => {
  it.each([
    [512, '512 B'],
    // The exact 1024 boundary crosses from bytes into the first divided unit.
    [1024, '1.0 KiB'],
    [2048, '2.0 KiB'],
    [5 * 1024 * 1024, '5.0 MiB'],
    [3 * 1024 * 1024 * 1024, '3.0 GiB'],
    // GiB is the largest unit: a TiB-scale value stays in GiB rather than inventing a bigger one.
    [1024 ** 4, '1024.0 GiB'],
  ])('%d -> %s', (bytes, label) => {
    expect(formatBytes(bytes)).toBe(label);
  });
});

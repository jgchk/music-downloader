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

describe('statusTone', () => {
  // The tone table stays a presentation mapping the web layer owns — exhaustive on purpose.
  it.each([
    ['Empty', 'pending'],
    ['Pending', 'pending'],
    ['AwaitingManualSelection', 'attention'],
    ['Searching', 'pending'],
    ['Selecting', 'pending'],
    ['Downloading', 'pending'],
    ['Validating', 'pending'],
    ['Importing', 'pending'],
    ['Fulfilled', 'fulfilled'],
    ['Exhausted', 'failed'],
    ['Cancelled', 'failed'],
    ['MetadataFailed', 'failed'],
    ['Conflicted', 'failed'],
  ] as const)('%s -> %s', (status, tone) => {
    expect(statusTone(status)).toBe(tone);
  });
});

describe('isCancellable / isTerminal — read the decided flag, not the enum', () => {
  it('tracks the decided cancellable flag, independent of the status enum', () => {
    // A terminal-looking status marked cancellable is cancellable; a working-looking status marked
    // not-cancellable is not — the flag wins, proving the enum is no longer consulted.
    expect(isCancellable(acquisition({ status: 'Fulfilled', cancellable: true }))).toBe(true);
    expect(isTerminal(acquisition({ status: 'Fulfilled', cancellable: true }))).toBe(false);
    expect(isCancellable(acquisition({ status: 'Downloading', cancellable: false }))).toBe(false);
    expect(isTerminal(acquisition({ status: 'Downloading', cancellable: false }))).toBe(true);
  });

  it('degrades to not-cancellable and not-terminal when the flag is absent (older producer)', () => {
    expect(isCancellable(acquisition({ status: 'Downloading' }))).toBe(false);
    expect(isTerminal(acquisition({ status: 'Exhausted' }))).toBe(false);
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
          cancellable: false,
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
    expect(outcomeSummary(acquisition({ status: 'Cancelled', cancellable: false }))).toBe(
      'Cancelled',
    );
  });

  it('shows no outcome for a failed status when the decided flag is absent (older producer)', () => {
    // The terminal gate reads the flag, so an absent flag degrades to no outcome line — never a
    // re-derivation from the status enum.
    expect(outcomeSummary(acquisition({ status: 'Exhausted' }))).toBeUndefined();
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

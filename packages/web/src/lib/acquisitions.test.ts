import { describe, expect, it } from 'vitest';
import type { AcquisitionStatusResponseDto } from '@music/downloader';
import {
  formatBytes,
  isCancellable,
  isTransferStarted,
  isTerminal,
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

describe('isTransferStarted', () => {
  it('reads the decided flag, not the history', () => {
    expect(isTransferStarted(acquisition({ transferStarted: true }))).toBe(true);
    expect(isTransferStarted(acquisition({ transferStarted: false }))).toBe(false);
  });

  it('degrades an absent flag (older producer) to not-yet-live', () => {
    expect(isTransferStarted(acquisition({}))).toBe(false);
  });
});

describe('statusTone', () => {
  it('degrades an unknown future status to the neutral pending tone', () => {
    // Simulates wire evolution ahead of this build (the copy layer's as-never idiom): the tone
    // must degrade honestly, never render undefined into the badge channel.
    expect(statusTone('BrandNewStatus' as never)).toBe('pending');
  });

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

  it('renders a resolving placeholder only while resolution is genuinely pending', () => {
    expect(targetDescription(acquisition({ status: 'Pending' }))).toBe('Resolving…');
    expect(targetDescription(acquisition({ status: 'Empty' }))).toBe('Resolving…');
  });

  it('falls back to the request as given when metadata never resolved', () => {
    expect(
      targetDescription(
        acquisition({
          status: 'MetadataFailed',
          cancellable: false,
          requestedTarget: { kind: 'descriptor', targetType: 'album', artist: 'A', title: 'T' },
        }),
      ),
    ).toBe('A — T');
  });

  it('labels a never-resolved id-only request neutrally, never a resolving placeholder', () => {
    expect(
      targetDescription(
        acquisition({
          status: 'MetadataFailed',
          cancellable: false,
          requestedTarget: { kind: 'musicbrainz', targetType: 'album', mbid: 'm-1' },
        }),
      ),
    ).toBe('Unknown release');
    expect(targetDescription(acquisition({ status: 'Exhausted', cancellable: false }))).toBe(
      'Unknown release',
    );
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

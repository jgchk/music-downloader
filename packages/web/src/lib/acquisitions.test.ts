import { describe, expect, it } from 'vitest';
import type { AcquisitionStatusResponseDto } from '@music/downloader';
import {
  formatBytes,
  isCancellable,
  isTerminal,
  outcomeSummary,
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
    ['Pending', 'pending', false],
    ['AwaitingManualSelection', 'pending', false],
    ['Searching', 'pending', false],
    ['Downloading', 'pending', false],
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
            { kind: 'selected', candidate },
            { kind: 'download-failed', candidate, reason: 'Stalled' },
            { kind: 'validation-failed', candidate, reasons: ['DurationMismatch'] },
            { kind: 'download-failed', candidate, reason: 'Stalled' },
            { kind: 'fulfillment-rejected', candidate, reasons: ['bad rip'] },
            { kind: 'imported', candidate, location: '/x' },
          ],
        }),
      ),
    ).toBe('Exhausted (Stalled, DurationMismatch, bad rip)');
  });

  it('renders a failed terminal state without reasons plainly', () => {
    expect(outcomeSummary(acquisition({ status: 'Cancelled' }))).toBe('Cancelled');
  });
});

describe('formatBytes', () => {
  it.each([
    [512, '512 B'],
    [2048, '2.0 KiB'],
    [5 * 1024 * 1024, '5.0 MiB'],
    [3 * 1024 * 1024 * 1024, '3.0 GiB'],
  ])('%d -> %s', (bytes, label) => {
    expect(formatBytes(bytes)).toBe(label);
  });
});

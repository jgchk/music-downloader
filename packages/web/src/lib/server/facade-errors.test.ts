import { describe, expect, it } from 'vitest';
import type { DownloaderFacadeError } from '@music/downloader';
import type { ImporterFacadeError } from '@music/importer';
import { messageOf, statusOf } from './facade-errors.js';

const downloaderErrors: DownloaderFacadeError[] = [
  { kind: 'ValidationFailed', message: 'request required' },
  { kind: 'InvalidPolicy' },
  { kind: 'NotFound' },
  { kind: 'AlreadyExists' },
  { kind: 'IllegalTransition', command: 'Cancel', phase: 'Fulfilled' },
  { kind: 'ConcurrencyConflict', streamId: 'acq-1', expectedVersion: 3 },
  { kind: 'InfraError', operation: 'store.append', message: 'disk full' },
];

const importerErrors: ImporterFacadeError[] = [
  { kind: 'ValidationFailed', message: 'path required' },
  { kind: 'NotFound' },
  { kind: 'UnknownImport' },
  { kind: 'NoOpenReview' },
  { kind: 'InvalidResolution', detail: 'verb not applicable' },
  { kind: 'UnknownCandidate', candidate: 'mb/abc' },
  { kind: 'NoRetainedCandidate' },
  { kind: 'ConcurrencyConflict', streamId: 'imp-1', expectedVersion: 1 },
  { kind: 'InfraError', operation: 'bridge.apply', message: 'timeout' },
];

describe('statusOf', () => {
  it.each([
    ['ValidationFailed', 400],
    ['InvalidPolicy', 400],
    ['NotFound', 404],
    ['AlreadyExists', 409],
    ['IllegalTransition', 409],
    ['ConcurrencyConflict', 409],
    ['InfraError', 500],
  ] as const)('%s -> %d (downloader)', (kind, status) => {
    const error = downloaderErrors.find((e) => e.kind === kind)!;
    expect(statusOf(error)).toBe(status);
  });

  it.each([
    ['UnknownImport', 404],
    ['NoOpenReview', 409],
    ['InvalidResolution', 400],
    ['UnknownCandidate', 400],
    ['NoRetainedCandidate', 409],
  ] as const)('%s -> %d (importer)', (kind, status) => {
    const error = importerErrors.find((e) => e.kind === kind)!;
    expect(statusOf(error)).toBe(status);
  });
});

describe('messageOf', () => {
  it('renders every downloader error kind as a human message', () => {
    for (const error of downloaderErrors) {
      expect(messageOf(error)).toBeTruthy();
    }
  });

  it('renders every importer error kind as a human message', () => {
    for (const error of importerErrors) {
      expect(messageOf(error)).toBeTruthy();
    }
  });

  it('carries actionable detail through', () => {
    expect(messageOf({ kind: 'ValidationFailed', message: 'mbid required' })).toContain(
      'mbid required',
    );
    expect(
      messageOf({ kind: 'IllegalTransition', command: 'Cancel', phase: 'Fulfilled' }),
    ).toContain('Fulfilled');
    expect(messageOf({ kind: 'UnknownCandidate', candidate: 'mb/x' })).toContain('mb/x');
    expect(messageOf({ kind: 'InvalidResolution', detail: 'no candidates' })).toContain(
      'no candidates',
    );
    expect(messageOf({ kind: 'InfraError', operation: 'bridge.apply', message: 'x' })).toContain(
      'bridge.apply',
    );
  });
});

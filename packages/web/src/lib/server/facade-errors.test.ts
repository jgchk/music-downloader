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
  { kind: 'UnknownEdition', releaseMbid: 'mbid-x' },
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
    ['UnknownEdition', 400],
    ['ConcurrencyConflict', 409],
    ['InfraError', 500],
  ] as const)('%s -> %d (downloader)', (kind, status) => {
    const error = downloaderErrors.find((entry) => entry.kind === kind)!;
    expect(statusOf(error)).toBe(status);
  });

  it.each([
    ['UnknownImport', 404],
    ['NoOpenReview', 409],
    ['InvalidResolution', 400],
    ['UnknownCandidate', 400],
    ['NoRetainedCandidate', 409],
  ] as const)('%s -> %d (importer)', (kind, status) => {
    const error = importerErrors.find((entry) => entry.kind === kind)!;
    expect(statusOf(error)).toBe(status);
  });
});

describe('messageOf', () => {
  it.each([
    ['ValidationFailed', 'Invalid input'],
    ['InvalidPolicy', 'policy'],
    ['NotFound', 'No such acquisition'],
    ['AlreadyExists', 'already exists'],
    ['IllegalTransition', 'not available'],
    ['UnknownEdition', 'Unknown edition'],
    ['ConcurrencyConflict', 'reload'],
    ['InfraError', 'Something went wrong'],
  ] as const)('renders the downloader %s error as a human message', (kind, needle) => {
    const message = messageOf(downloaderErrors.find((entry) => entry.kind === kind)!);
    expect(message).toMatch(/\S/);
    expect(message).toContain(needle);
  });

  it.each([
    ['ValidationFailed', 'Invalid input'],
    ['NotFound', 'No such acquisition'],
    ['UnknownImport', 'No such import'],
    ['NoOpenReview', 'already been settled'],
    ['InvalidResolution', 'Invalid resolution'],
    ['UnknownCandidate', 'Unknown candidate'],
    ['NoRetainedCandidate', 'retained candidate'],
    ['ConcurrencyConflict', 'reload'],
    ['InfraError', 'Something went wrong'],
  ] as const)('renders the importer %s error as a human message', (kind, needle) => {
    const message = messageOf(importerErrors.find((entry) => entry.kind === kind)!);
    expect(message).toMatch(/\S/);
    expect(message).toContain(needle);
  });

  it('carries actionable detail through', () => {
    expect(messageOf({ kind: 'ValidationFailed', message: 'mbid required' })).toContain(
      'mbid required',
    );
    expect(
      messageOf({ kind: 'IllegalTransition', command: 'Cancel', phase: 'Fulfilled' }),
    ).toContain('Fulfilled');
    expect(messageOf({ kind: 'UnknownCandidate', candidate: 'mb/x' })).toContain('mb/x');
    expect(messageOf({ kind: 'UnknownEdition', releaseMbid: 'mb/ed' })).toContain('mb/ed');
    expect(messageOf({ kind: 'InvalidResolution', detail: 'no candidates' })).toContain(
      'no candidates',
    );
    expect(messageOf({ kind: 'InfraError', operation: 'bridge.apply', message: 'x' })).toContain(
      'bridge.apply',
    );
  });
});

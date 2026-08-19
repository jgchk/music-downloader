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
  { kind: 'UnknownMatch', candidate: 'mb/abc' },
  { kind: 'NoRetainedCopy' },
  { kind: 'CycleInFlight' },
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
    ['InfraError', 502],
  ] as const)('%s -> %d (downloader)', (kind, status) => {
    const error = downloaderErrors.find((entry) => entry.kind === kind)!;
    expect(statusOf(error)).toBe(status);
  });

  it('answers a fault that may pass with a status that says so', () => {
    // 502: the thing behind us could not be reached. A caller may try again and it may work.
    expect(statusOf({ kind: 'InfraError', operation: 'catalog.search', message: 'timeout' })).toBe(
      502,
    );
  });

  it('answers a fault that will not pass as this application going wrong', () => {
    // 500: the answer could not be READ. No amount of retrying by anyone outside fixes that, and
    // saying "try again" to a person would be a lie.
    expect(
      statusOf({
        kind: 'InfraError',
        operation: 'catalog.search',
        message: 'drifted',
        permanent: true,
      }),
    ).toBe(500);
  });

  it.each([
    ['UnknownImport', 404],
    ['NoOpenReview', 409],
    ['InvalidResolution', 400],
    ['UnknownMatch', 400],
    ['NoRetainedCopy', 409],
    ['CycleInFlight', 409],
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
    ['UnknownMatch', 'Unknown match'],
    ['NoRetainedCopy', 'tracked download'],
    ['CycleInFlight', 'still in progress'],
    ['ConcurrencyConflict', 'reload'],
    ['InfraError', 'Something went wrong'],
  ] as const)('renders the importer %s error as a human message', (kind, needle) => {
    const message = messageOf(importerErrors.find((entry) => entry.kind === kind)!);
    expect(message).toMatch(/\S/);
    expect(message).toContain(needle);
    // One-voice register: user-visible error copy never names a module or architecture noun.
    expect(message).not.toMatch(/downloader|importer/i);
  });

  it('carries actionable detail through', () => {
    expect(messageOf({ kind: 'ValidationFailed', message: 'mbid required' })).toContain(
      'mbid required',
    );
    expect(
      messageOf({ kind: 'IllegalTransition', command: 'Cancel', phase: 'Fulfilled' }),
    ).toContain('Fulfilled');
    expect(messageOf({ kind: 'UnknownMatch', candidate: 'mb/x' })).toContain('mb/x');
    expect(messageOf({ kind: 'UnknownEdition', releaseMbid: 'mb/ed' })).toContain('mb/ed');
    expect(messageOf({ kind: 'InvalidResolution', detail: 'no candidates' })).toContain(
      'no candidates',
    );
    // An infrastructure fault is the one kind with NO actionable detail to carry: its operation
    // is a module noun, and the diagnosis belongs in the log beside the correlation id.
    expect(
      messageOf({ kind: 'InfraError', operation: 'bridge.apply', message: 'x' }),
    ).not.toContain('bridge.apply');
  });
});

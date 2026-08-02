import { describe, expect, it } from 'vitest';
import type { Logger } from 'pino';
import type { DownloaderFacade } from '@music/downloader';
import type { ImporterFacade } from '@music/importer';
import type { Facades } from './runtime.js';
import { acquisitionTitleFor, reviewTitlesFor } from './review-titles.js';

/**
 * The title composition (reviews-register-alignment D3): importId → getImport → acquisitionId →
 * downloader status → the acquisition's request phrase. Modeled misses (failed read, missing
 * correlation) degrade quietly; an unexpected thrown fault degrades too but leaves a logged
 * trace — the guardedRead treatment.
 */

function facades(over: {
  getImport?: (input: unknown) => unknown;
  getAcquisition?: (input: unknown) => unknown;
}): Facades {
  return {
    importer: { getImport: over.getImport } as unknown as ImporterFacade,
    downloader: { getAcquisition: over.getAcquisition } as unknown as DownloaderFacade,
  };
}

function testLogger(): { logger: Logger; warnings: unknown[] } {
  const warnings: unknown[] = [];
  return {
    warnings,
    logger: { warn: (context: unknown) => void warnings.push(context) } as unknown as Logger,
  };
}

const acquisition = {
  acquisitionId: 'acq-1',
  status: 'Fulfilled',
  attempts: 1,
  rejectedCount: 0,
  history: [],
  target: { artist: 'Artist', title: 'Album' },
};

describe('acquisitionTitleFor', () => {
  it('composes the acquisition request phrase for a correlated import', () => {
    const { logger, warnings } = testLogger();
    const composed = acquisitionTitleFor(
      facades({
        getImport: () => ({
          ok: true,
          value: { importId: 'imp-1', acquisitionId: 'acq-1', status: 'x' },
        }),
        getAcquisition: () => ({ ok: true, value: acquisition }),
      }),
      'imp-1',
      logger,
    );
    expect(composed).toBe('Artist — Album');
    expect(warnings).toEqual([]);
  });

  it('addresses each facade by the right id', () => {
    const { logger } = testLogger();
    const seen: unknown[] = [];
    acquisitionTitleFor(
      facades({
        getImport: (input) => {
          seen.push(input);
          return { ok: true, value: { importId: 'imp-1', acquisitionId: 'acq-1' } };
        },
        getAcquisition: (input) => {
          seen.push(input);
          return { ok: true, value: acquisition };
        },
      }),
      'imp-1',
      logger,
    );
    expect(seen).toEqual([{ id: 'imp-1' }, { id: 'acq-1' }]);
  });

  it('returns undefined, without logging, when the import read fails (a modeled miss)', () => {
    const { logger, warnings } = testLogger();
    const composed = acquisitionTitleFor(
      facades({ getImport: () => ({ ok: false, error: { kind: 'NotFound' } }) }),
      'imp-1',
      logger,
    );
    expect(composed).toBeUndefined();
    expect(warnings).toEqual([]);
  });

  it('returns undefined for an import with no acquisition correlation', () => {
    const { logger } = testLogger();
    const composed = acquisitionTitleFor(
      facades({ getImport: () => ({ ok: true, value: { importId: 'imp-1', status: 'x' } }) }),
      'imp-1',
      logger,
    );
    expect(composed).toBeUndefined();
  });

  it('returns undefined when the acquisition read fails', () => {
    const { logger } = testLogger();
    const composed = acquisitionTitleFor(
      facades({
        getImport: () => ({ ok: true, value: { importId: 'imp-1', acquisitionId: 'acq-1' } }),
        getAcquisition: () => ({ ok: false, error: { kind: 'NotFound' } }),
      }),
      'imp-1',
      logger,
    );
    expect(composed).toBeUndefined();
  });

  it('degrades a thrown fault to undefined AND logs the trace', () => {
    const { logger, warnings } = testLogger();
    const fault = new Error('store gone');
    const composed = acquisitionTitleFor(
      facades({
        getImport: () => {
          throw fault;
        },
      }),
      'imp-1',
      logger,
    );
    expect(composed).toBeUndefined();
    expect(warnings).toEqual([{ err: fault, importId: 'imp-1' }]);
  });
});

describe('reviewTitlesFor', () => {
  it('maps only the imports that compose a title', () => {
    const { logger } = testLogger();
    const titles = reviewTitlesFor(
      facades({
        getImport: (input) =>
          (input as { id: string }).id === 'imp-1'
            ? { ok: true, value: { importId: 'imp-1', acquisitionId: 'acq-1' } }
            : { ok: false, error: { kind: 'NotFound' } },
        getAcquisition: () => ({ ok: true, value: acquisition }),
      }),
      ['imp-1', 'imp-2'],
      logger,
    );
    expect(titles).toEqual(new Map([['imp-1', 'Artist — Album']]));
  });
});

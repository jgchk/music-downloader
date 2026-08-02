import { describe, expect, it } from 'vitest';
import type { DownloaderFacade } from '@music/downloader';
import type { ImporterFacade } from '@music/importer';
import type { Facades } from './runtime.js';
import { acquisitionTitleFor, reviewTitlesFor } from './review-titles.js';

/**
 * The title composition (design D3): importId → getImport → acquisitionId → downloader status →
 * the acquisition's request phrase. Every link is failure-tolerant — a broken link means "no
 * composed title", never an error, so the caller's fallback chain takes over.
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
    const composed = acquisitionTitleFor(
      facades({
        getImport: (input) => {
          expect(input).toEqual({ id: 'imp-1' });
          return { ok: true, value: { importId: 'imp-1', acquisitionId: 'acq-1', status: 'x' } };
        },
        getAcquisition: (input) => {
          expect(input).toEqual({ id: 'acq-1' });
          return { ok: true, value: acquisition };
        },
      }),
      'imp-1',
    );
    expect(composed).toBe('Artist — Album');
  });

  it('returns undefined when the import read fails', () => {
    const composed = acquisitionTitleFor(
      facades({ getImport: () => ({ ok: false, error: { kind: 'NotFound' } }) }),
      'imp-1',
    );
    expect(composed).toBeUndefined();
  });

  it('returns undefined for an import with no acquisition correlation', () => {
    const composed = acquisitionTitleFor(
      facades({ getImport: () => ({ ok: true, value: { importId: 'imp-1', status: 'x' } }) }),
      'imp-1',
    );
    expect(composed).toBeUndefined();
  });

  it('returns undefined when the acquisition read fails', () => {
    const composed = acquisitionTitleFor(
      facades({
        getImport: () => ({ ok: true, value: { importId: 'imp-1', acquisitionId: 'acq-1' } }),
        getAcquisition: () => ({ ok: false, error: { kind: 'NotFound' } }),
      }),
      'imp-1',
    );
    expect(composed).toBeUndefined();
  });

  it('returns undefined when a facade read throws, never letting the fault escape', () => {
    const composed = acquisitionTitleFor(
      facades({
        getImport: () => {
          throw new Error('store gone');
        },
      }),
      'imp-1',
    );
    expect(composed).toBeUndefined();
  });
});

describe('reviewTitlesFor', () => {
  it('maps only the imports that compose a title', () => {
    const titles = reviewTitlesFor(
      facades({
        getImport: (input) =>
          (input as { id: string }).id === 'imp-1'
            ? { ok: true, value: { importId: 'imp-1', acquisitionId: 'acq-1' } }
            : { ok: false, error: { kind: 'NotFound' } },
        getAcquisition: () => ({ ok: true, value: acquisition }),
      }),
      ['imp-1', 'imp-2'],
    );
    expect(titles).toEqual(new Map([['imp-1', 'Artist — Album']]));
  });
});

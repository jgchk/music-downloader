import { describe, expect, it } from 'vitest';
import type { DownloaderFacade } from '@music/downloader';
import { load } from './+layout.server.js';

const list = { acquisitions: [{ acquisitionId: 'acq-1' }] };

function run(pathname: string): { list: unknown; selectedId: string | undefined } {
  const facades = {
    downloader: { listAcquisitions: () => list } as unknown as DownloaderFacade,
  };
  return load({ locals: { facades }, url: new URL(`http://host${pathname}`) } as never) as {
    list: unknown;
    selectedId: string | undefined;
  };
}

describe('acquisitions layout load', () => {
  it('returns the facade list with no selection on the index', () => {
    expect(run('/acquisitions')).toEqual({ list, selectedId: undefined });
  });

  it('derives the selected id from a detail URL (with or without a trailing slash)', () => {
    expect(run('/acquisitions/acq-1').selectedId).toBe('acq-1');
    expect(run('/acquisitions/acq-1/').selectedId).toBe('acq-1');
  });

  it('treats the new-request route as no selection', () => {
    expect(run('/acquisitions/new').selectedId).toBeUndefined();
  });
});

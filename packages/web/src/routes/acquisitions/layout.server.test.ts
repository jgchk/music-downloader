import { describe, expect, it } from 'vitest';
import type { Logger } from 'pino';
import type { DownloaderFacade } from '@music/downloader';
import { load } from './+layout.server.js';

function event(over: { listAcquisitions?: () => unknown; id?: string; pathname?: string }): {
  event: { locals: App.Locals; params: { id?: string }; url: URL };
  warnings: unknown[];
} {
  const warnings: unknown[] = [];
  return {
    warnings,
    event: {
      params: { id: over.id },
      url: new URL(`http://localhost${over.pathname ?? '/acquisitions'}`),
      locals: {
        facades: {
          downloader: {
            listAcquisitions:
              over.listAcquisitions ?? (() => ({ acquisitions: [{ acquisitionId: 'acq-1' }] })),
          } as unknown as DownloaderFacade,
        },
        logger: { warn: (context: unknown) => void warnings.push(context) } as unknown as Logger,
      } as unknown as App.Locals,
    },
  };
}

describe('acquisitions layout load', () => {
  it('returns the guarded list with no selection on the index', () => {
    const { event: requestEvent } = event({ id: undefined });
    expect(load(requestEvent as never)).toEqual({
      acquisitions: [{ acquisitionId: 'acq-1' }],
      listFailed: false,
      selectedId: undefined,
      detailActive: false,
    });
  });

  it('carries the route param as the selected id', () => {
    const { event: requestEvent } = event({ id: 'acq-1' });
    expect((load(requestEvent as never) as { selectedId: string | undefined }).selectedId).toBe(
      'acq-1',
    );
  });

  it.each([
    ['/acquisitions', false],
    ['/acquisitions/new', true],
    ['/acquisitions/acq-1', true],
  ])('reports %s as detail-active: %s', (pathname, expected) => {
    const { event: requestEvent } = event({ pathname });
    expect((load(requestEvent as never) as { detailActive: boolean }).detailActive).toBe(expected);
  });

  it('hands the queue to the page newest-requested first', () => {
    const { event: requestEvent } = event({
      listAcquisitions: () => ({
        acquisitions: [
          { acquisitionId: 'older', requestedAt: '2026-01-01T00:00:00Z' },
          { acquisitionId: 'newer', requestedAt: '2026-02-01T00:00:00Z' },
        ],
      }),
    });
    const { acquisitions } = load(requestEvent as never) as {
      acquisitions: { acquisitionId: string }[];
    };
    expect(acquisitions.map((entry) => entry.acquisitionId)).toEqual(['newer', 'older']);
  });

  it('degrades to an empty, flagged list and logs when the downloader read throws', () => {
    const fault = new Error('downloader store gone');
    const { event: requestEvent, warnings } = event({
      listAcquisitions: () => {
        throw fault;
      },
    });
    expect(load(requestEvent as never)).toEqual({
      acquisitions: [],
      listFailed: true,
      selectedId: undefined,
      detailActive: false,
    });
    expect(warnings).toEqual([{ err: fault, module: 'downloader' }]);
  });
});

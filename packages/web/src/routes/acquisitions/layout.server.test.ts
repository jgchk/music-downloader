import { describe, expect, it } from 'vitest';
import type { Logger } from 'pino';
import type { DownloaderFacade } from '@music/downloader';
import { load } from './+layout.server.js';

function event(over: { listAcquisitions?: () => unknown; id?: string }): {
  event: { locals: App.Locals; params: { id?: string } };
  warnings: unknown[];
} {
  const warnings: unknown[] = [];
  return {
    warnings,
    event: {
      params: { id: over.id },
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
    });
  });

  it('carries the route param as the selected id', () => {
    const { event: requestEvent } = event({ id: 'acq-1' });
    expect((load(requestEvent as never) as { selectedId: string | undefined }).selectedId).toBe(
      'acq-1',
    );
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
    });
    expect(warnings).toEqual([{ err: fault, module: 'downloader' }]);
  });
});

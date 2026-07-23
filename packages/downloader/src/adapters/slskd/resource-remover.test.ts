import { describe, expect, it } from 'vitest';
import { silentLogger } from '../../application/__fixtures__/fakes.js';
import type { SourceResource } from '../../application/ports/resource-ledger-port.js';
import type { HttpClient, HttpResponse } from '../support/http.js';
import { SlskdClient } from './client.js';
import { SlskdResourceRemover } from './resource-remover.js';
import type { Timer } from './timer.js';

const ok: HttpResponse = { status: 204, body: '' };
const search: SourceResource = {
  source: 'slskd',
  kind: 'search',
  resourceKey: 's1',
  resourceId: 's1',
  acquisitionId: 'acq-1',
};
const transfer = (resourceId?: string): SourceResource => ({
  source: 'slskd',
  kind: 'transfer',
  resourceKey: String.raw`u1|@@a\Album\01.flac`,
  resourceId,
  acquisitionId: 'acq-1',
});

function payload(files: readonly unknown[]): HttpResponse {
  return { status: 200, body: JSON.stringify({ username: 'u1', directories: [{ files }] }) };
}
const gone = payload([]);
const present = (state: string, id = 'live-id'): HttpResponse =>
  payload([{ id, filename: String.raw`@@a\Album\01.flac`, state }]);

function fakeTimer(): Timer {
  let current = 0;
  return {
    now: () => current,
    sleep: (ms) => {
      current += ms;
      return Promise.resolve();
    },
  };
}

/** A remover whose GET (transfer-poll) responses are drained in order (last one repeats). */
function remover(
  gets: HttpResponse[],
  deletionStatus = 204,
): {
  remover: SlskdResourceRemover;
  deletes: string[];
  getCount: () => number;
} {
  const deletes: string[] = [];
  const queue = [...gets];
  let requestCount = 0;
  const http: HttpClient = {
    send: ({ method, url }) => {
      if (method === 'DELETE') {
        deletes.push(url);
        return Promise.resolve({ status: deletionStatus, body: '' });
      }
      requestCount += 1;
      const next = queue.length > 1 ? queue.shift()! : (queue[0] ?? gone);
      return Promise.resolve(next);
    },
  };
  return {
    remover: new SlskdResourceRemover(silentLogger(), new SlskdClient(http), fakeTimer(), 10),
    deletes,
    getCount: () => requestCount,
  };
}

describe('SlskdResourceRemover', () => {
  it('deletes a search by its id and reports it confirmed gone', async () => {
    const { remover: r, deletes } = remover([ok]);

    const removalResult = await r.remove(search);
    expect(removalResult._unsafeUnwrap()).toBe(true);
    expect(deletes).toEqual(['http://localhost:5030/api/v0/searches/s1']);
  });

  it('removes an already-terminal transfer on the first pass and confirms it gone', async () => {
    const { remover: r, deletes } = remover([present('Completed, Succeeded'), gone]);

    const removalResult2 = await r.remove(transfer('live-id'));
    expect(removalResult2._unsafeUnwrap()).toBe(true);
    expect(deletes).toEqual([
      'http://localhost:5030/api/v0/transfers/downloads/u1/live-id?remove=true',
    ]);
  });

  it('cancels an in-flight transfer, then removes it once it turns terminal', async () => {
    const { remover: r, deletes } = remover([
      present('InProgress'), // cancel-only (remove=false)
      present('Completed, Cancelled'), // now terminal — remove it
      gone, // confirmed gone
    ]);

    const removalResult3 = await r.remove(transfer('live-id'));
    expect(removalResult3._unsafeUnwrap()).toBe(true);
    expect(deletes).toEqual([
      'http://localhost:5030/api/v0/transfers/downloads/u1/live-id?remove=false',
      'http://localhost:5030/api/v0/transfers/downloads/u1/live-id?remove=true',
    ]);
  });

  it('looks a transfer up by filename when its id was never captured', async () => {
    const { remover: r, deletes } = remover([present('Completed, Succeeded'), gone]);

    const removalResult4 = await r.remove(transfer());
    expect(removalResult4._unsafeUnwrap()).toBe(true);
    expect(deletes).toEqual([
      'http://localhost:5030/api/v0/transfers/downloads/u1/live-id?remove=true',
    ]);
  });

  it('falls back to the captured GUID when the polled record omits its id', async () => {
    // The transfer is found by filename but the payload carries no id; remove by the captured GUID.
    const noId = payload([
      { filename: String.raw`@@a\Album\01.flac`, state: 'Completed, Succeeded' },
    ]);
    const { remover: r, deletes } = remover([noId, gone]);

    const removalResult5 = await r.remove(transfer('guid-9'));
    expect(removalResult5._unsafeUnwrap()).toBe(true);
    expect(deletes).toEqual([
      'http://localhost:5030/api/v0/transfers/downloads/u1/guid-9?remove=true',
    ]);
  });

  it('removes an idless transfer at the bare path when no GUID was ever captured', async () => {
    const noId = payload([
      { filename: String.raw`@@a\Album\01.flac`, state: 'Completed, Succeeded' },
    ]);
    const { remover: r, deletes } = remover([noId, gone]);

    const removalResult6 = await r.remove(transfer());
    expect(removalResult6._unsafeUnwrap()).toBe(true);
    expect(deletes).toEqual(['http://localhost:5030/api/v0/transfers/downloads/u1/?remove=true']);
  });

  it('locates a transfer by its captured GUID when the polled filename differs', async () => {
    // slskd renamed the file on disk, so match on the captured id rather than the filename.
    const renamed = payload([
      { id: 'guid-9', filename: String.raw`@@a\Album\renamed.flac`, state: 'Completed, Succeeded' },
    ]);
    const { remover: r, deletes } = remover([renamed, gone]);

    const removalResult7 = await r.remove(transfer('guid-9'));
    expect(removalResult7._unsafeUnwrap()).toBe(true);
    expect(deletes).toEqual([
      'http://localhost:5030/api/v0/transfers/downloads/u1/guid-9?remove=true',
    ]);
  });

  it('no-ops when only another tenant’s transfer is present', async () => {
    // A foreign transfer (different filename, no captured id to match) is left untouched.
    const foreign = payload([
      { id: 'x', filename: String.raw`@@a\Other\9.flac`, state: 'InProgress' },
    ]);
    const { remover: r, deletes, getCount } = remover([foreign]);

    const removalResult8 = await r.remove(transfer());
    expect(removalResult8._unsafeUnwrap()).toBe(true);
    expect(deletes).toEqual([]); // nothing of ours to remove
    expect(getCount()).toBe(1);
  });

  it('reports a lingering transfer unconfirmed after the retry bound', async () => {
    const { remover: r, deletes } = remover([present('InProgress')]); // never transitions

    // Cancelled each round but never terminal, so it is left for the next boot's sweep.
    const removalResult9 = await r.remove(transfer('live-id'));
    expect(removalResult9._unsafeUnwrap()).toBe(false);
    expect(deletes).toEqual([
      'http://localhost:5030/api/v0/transfers/downloads/u1/live-id?remove=false',
      'http://localhost:5030/api/v0/transfers/downloads/u1/live-id?remove=false',
      'http://localhost:5030/api/v0/transfers/downloads/u1/live-id?remove=false',
    ]);
  });

  it('treats a 404 transfer listing as already-gone: confirms the removal (prod 2026-07-22)', async () => {
    // slskd 404s the downloads collection for a user with no transfers; a swept transfer that is
    // already gone must converge (row marked removed), not surface a retryable fault that leaves the
    // ledger row live forever.
    const { remover: r, deletes } = remover([{ status: 404, body: '' }]);

    const removalResult10 = await r.remove(transfer('live-id'));
    expect(removalResult10._unsafeUnwrap()).toBe(true);
    expect(deletes).toEqual([]); // nothing at the source to remove
  });

  it('surfaces a transport fault as an InfraError', async () => {
    const { remover: r } = remover([ok], 500);

    const result = await r.remove(search);

    expect(result._unsafeUnwrapErr()).toMatchObject({
      kind: 'InfraError',
      operation: 'slskd.resource-remove',
    });
  });
});

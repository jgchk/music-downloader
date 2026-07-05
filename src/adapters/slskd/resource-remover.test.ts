import { describe, expect, it } from 'vitest';
import { silentLogger } from '../../application/__fixtures__/fakes.js';
import type { SourceResource } from '../../application/ports/resource-ledger-port.js';
import type { HttpClient, HttpRequest, HttpResponse } from '../support/http.js';
import { SlskdClient } from './client.js';
import { SlskdResourceRemover } from './resource-remover.js';

function remover(handler: (request: HttpRequest) => HttpResponse): {
  remover: SlskdResourceRemover;
  requests: HttpRequest[];
} {
  const requests: HttpRequest[] = [];
  const http: HttpClient = {
    send: (request) => {
      requests.push(request);
      return Promise.resolve(handler(request));
    },
  };
  return { remover: new SlskdResourceRemover(silentLogger(), new SlskdClient(http)), requests };
}

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
  resourceKey: 'u1|@@a\\Album\\01.flac',
  resourceId,
  acquisitionId: 'acq-1',
});

function transferPayload(files: readonly unknown[]): HttpResponse {
  return { status: 200, body: JSON.stringify({ username: 'u1', directories: [{ files }] }) };
}

describe('SlskdResourceRemover', () => {
  it('deletes a search by its id', async () => {
    const { remover: r, requests } = remover(() => ok);

    (await r.remove(search))._unsafeUnwrap();

    expect(requests).toMatchObject([
      { method: 'DELETE', url: 'http://localhost:5030/api/v0/searches/s1' },
    ]);
  });

  it('cancels and removes a transfer by its captured id, without a lookup', async () => {
    const { remover: r, requests } = remover(() => ok);

    (await r.remove(transfer('guid-9')))._unsafeUnwrap();

    expect(requests).toMatchObject([
      {
        method: 'DELETE',
        url: 'http://localhost:5030/api/v0/transfers/downloads/u1/guid-9?remove=true',
      },
    ]);
  });

  it('looks a transfer up by filename when its id was never captured', async () => {
    const { remover: r, requests } = remover((request) =>
      request.method === 'GET'
        ? transferPayload([{ id: 'live-id', filename: '@@a\\Album\\01.flac' }])
        : ok,
    );

    (await r.remove(transfer()))._unsafeUnwrap();

    expect(requests.map((request) => request.method)).toEqual(['GET', 'DELETE']);
    expect(requests[1]!.url).toContain('/transfers/downloads/u1/live-id?remove=true');
  });

  it('no-ops a transfer that is already gone from the source', async () => {
    const { remover: r, requests } = remover(() => transferPayload([]));

    (await r.remove(transfer()))._unsafeUnwrap();

    expect(requests.map((request) => request.method)).toEqual(['GET']); // nothing left to DELETE
  });

  it('surfaces a transport fault as an InfraError', async () => {
    const { remover: r } = remover(() => ({ status: 500, body: 'boom' }));

    const result = await r.remove(search);

    expect(result._unsafeUnwrapErr()).toMatchObject({
      kind: 'InfraError',
      operation: 'slskd.resource-remove',
    });
  });
});

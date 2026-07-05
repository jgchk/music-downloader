/**
 * The explicit manifest of the slskd API surface this project consumes (task 4.1). It is the
 * contract the drift tier checks the live spec against: every entry must still exist, with the
 * path parameters and request-body fields the adapters depend on, in whatever slskd ships next.
 *
 * Response bodies are deliberately absent here — slskd's generated OpenAPI leaves most 2xx
 * responses unschematized (verified against 0.22.5), so response shape is pinned by the recorded
 * fixtures and enforced at runtime by the zod schemas instead. This manifest covers what the spec
 * *does* reliably declare: operations, path parameters, and request schemas.
 */

export interface SlskdOperation {
  readonly method: 'get' | 'post' | 'delete';
  /** OpenAPI path template, e.g. `/api/v0/searches/{id}`. */
  readonly path: string;
  /** Path parameters the adapter fills in. */
  readonly pathParams: readonly string[];
  /** A request body the adapter sends, resolved through `#/components/schemas`. */
  readonly requestBody?: {
    /** Component schema name (for an array body, the item schema). */
    readonly schema: string;
    /** Whether the body is an array of that schema. */
    readonly array: boolean;
    /** Properties the adapter sends and relies on. */
    readonly fields: readonly string[];
  };
  readonly usedBy: string;
}

export const SLSKD_CONSUMED_OPERATIONS: readonly SlskdOperation[] = [
  {
    method: 'post',
    path: '/api/v0/searches',
    pathParams: [],
    requestBody: { schema: 'SearchRequest', array: false, fields: ['searchText'] },
    usedBy: 'SlskdSearch — create a search',
  },
  {
    method: 'get',
    path: '/api/v0/searches/{id}',
    pathParams: ['id'],
    usedBy: 'SlskdSearch — poll completion (isComplete)',
  },
  {
    method: 'get',
    path: '/api/v0/searches/{id}/responses',
    pathParams: ['id'],
    usedBy: 'SlskdSearch — read per-peer responses',
  },
  {
    method: 'post',
    path: '/api/v0/transfers/downloads/{username}',
    pathParams: ['username'],
    requestBody: { schema: 'QueueDownloadRequest', array: true, fields: ['filename', 'size'] },
    usedBy: 'SlskdDownload — enqueue a candidate',
  },
  {
    method: 'get',
    path: '/api/v0/transfers/downloads/{username}',
    pathParams: ['username'],
    usedBy: 'SlskdDownload — poll transfer progress',
  },
  {
    method: 'delete',
    path: '/api/v0/transfers/downloads/{username}/{id}',
    pathParams: ['username', 'id'],
    usedBy: 'SlskdDownload — abandon a transfer',
  },
];

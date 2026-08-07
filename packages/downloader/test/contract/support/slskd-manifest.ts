/**
 * The explicit manifest of the slskd API surface this project consumes (task 4.1). It is the
 * contract the drift tier checks the live spec against: every entry must still exist, with the
 * path parameters and request-body fields the adapters depend on, in whatever slskd ships next.
 *
 * Response bodies are deliberately absent here — slskd's generated OpenAPI leaves most 2xx
 * responses unschematized (verified against 0.22.5), so response shape is pinned by the recorded
 * fixtures and enforced at runtime by the zod schemas instead. This manifest covers what the spec
 * *does* reliably declare: operations, path parameters, query parameters, and request schemas.
 */

export interface SlskdOperation {
  readonly method: 'get' | 'post' | 'delete';
  /** OpenAPI path template, e.g. `/api/v0/searches/{id}`. */
  readonly path: string;
  /** Path parameters the adapter fills in. */
  readonly pathParams: readonly string[];
  /**
   * Query parameters the adapter sends. As load-bearing as a path segment: the teardown's
   * `?remove=` is the difference between cancelling a transfer and destroying its record, and
   * slskd rejects the wrong one outright — so it is declared surface, not an implementation
   * detail of a URL string.
   */
  readonly queryParams?: readonly string[];
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

/** A request as the replay server observed it. */
export interface IssuedRequest {
  readonly method: string;
  /** URL pathname, without the query string. */
  readonly path: string;
  /** Query parameters actually sent. Required: the observer always captures them, and an optional
   * field here is what would let the query check pass vacuously if one ever stopped. */
  readonly query: Record<string, string>;
}

/** Whether a concrete pathname is an instance of an OpenAPI-style path template. */
function isPathMatch(template: string, path: string): boolean {
  const wanted = template.split('/');
  const actual = path.split('/');
  if (wanted.length !== actual.length) return false;
  return wanted.every(
    (segment, index) =>
      (segment.startsWith('{') && segment.endsWith('}') && actual[index] !== '') ||
      segment === actual[index],
  );
}

/**
 * The operations among `requests` that no manifest entry declares, each named once, in first-issued
 * order. This is the enforcement behind "the manifest cannot under-declare": a replay test drives
 * the real adapter, and every request it actually sent has to correspond to declared surface. An
 * endpoint an adapter quietly starts using is then a tier failure at the moment it is used, rather
 * than a gap discovered years later when a slskd upgrade breaks it unwatched.
 */
export function undeclaredOperations(
  requests: readonly IssuedRequest[],
  operations: readonly SlskdOperation[],
): string[] {
  const undeclared: string[] = [];
  for (const request of requests) {
    const isDeclared = operations.some(
      (op) => op.method === request.method.toLowerCase() && isPathMatch(op.path, request.path),
    );
    const label = `${request.method.toUpperCase()} ${request.path}`;
    if (!isDeclared && !undeclared.includes(label)) undeclared.push(label);
  }
  return undeclared;
}

/**
 * Query parameters the adapters actually sent that no manifest entry declares, as
 * `METHOD /path?param` labels. The path-level check above cannot see these — a request's query
 * string is not part of its operation identity — so without this the `queryParams` concept would be
 * verified in one direction only: `checkSlskdSpec` proves slskd still *offers* a declared
 * parameter, and nothing proved we still send it, or that what we send was ever declared.
 */
export function undeclaredQueryParams(
  requests: readonly IssuedRequest[],
  operations: readonly SlskdOperation[],
): string[] {
  const undeclared: string[] = [];
  for (const request of requests) {
    const op = operations.find(
      (candidate) =>
        candidate.method === request.method.toLowerCase() &&
        isPathMatch(candidate.path, request.path),
    );
    if (op === undefined) continue; // an undeclared *operation* is the other check's finding
    for (const param of Object.keys(request.query)) {
      const label = `${request.method.toUpperCase()} ${op.path}?${param}`;
      if (!(op.queryParams ?? []).includes(param) && !undeclared.includes(label)) {
        undeclared.push(label);
      }
    }
  }
  return undeclared;
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
    usedBy: 'SlskdSearch — poll completion (isComplete, state, responseCount)',
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
    path: '/api/v0/searches/{id}',
    pathParams: ['id'],
    usedBy: 'SlskdSearch — release a finished search at the source',
  },
  {
    method: 'delete',
    path: '/api/v0/transfers/downloads/{username}/{id}',
    pathParams: ['username', 'id'],
    queryParams: ['remove'],
    usedBy:
      'SlskdDownload — cancel a transfer (?remove=false) then remove its record (?remove=true)',
  },
  {
    method: 'get',
    path: '/api/v0/events',
    pathParams: [],
    queryParams: ['offset', 'limit'],
    usedBy:
      'SlskdDownload — resolve a completed download’s on-disk location (DownloadFileComplete)',
  },
  {
    method: 'get',
    path: '/api/v0/options',
    pathParams: [],
    usedBy: 'SlskdDownload — read the downloads root (directories.downloads)',
  },
];

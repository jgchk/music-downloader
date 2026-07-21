import { errAsync, okAsync } from 'neverthrow';
import type { ResultAsync } from 'neverthrow';
import type { Statement } from 'better-sqlite3';
import { infraError } from '../../application/ports/errors.js';
import type { InfraError } from '../../application/ports/errors.js';
import type {
  ResourceLedgerStore,
  SourceResource,
  SourceResourceKey,
} from '../../application/ports/resource-ledger-port.js';
import type { Clock } from '../../application/ports/system-ports.js';
import type { EventDatabase } from './schema.js';

/**
 * The SQLite `ResourceLedgerStore` (D: source-resource stewardship). One row per owned resource,
 * keyed by (source, kind, resource_key, acquisition_id); a NULL `removed_at` marks a resource the
 * app still owes the source a removal for. `recordCreated` is insert-if-absent so a retried
 * write-ahead recording never duplicates a row nor clobbers an id captured in between.
 */

interface ResourceRow {
  readonly source: string;
  readonly kind: string;
  readonly resource_key: string;
  readonly resource_id: string | null;
  readonly acquisition_id: string;
}

// better-sqlite3 always throws Error values from a closed/faulted connection, so stringifying is safe.
function errorMessage(err: unknown): string {
  return String(err);
}

function keyParams(key: SourceResourceKey): Record<string, string> {
  return {
    source: key.source,
    kind: key.kind,
    resourceKey: key.resourceKey,
    acquisitionId: key.acquisitionId,
  };
}

function toResource(row: ResourceRow): SourceResource {
  return {
    source: row.source,
    kind: row.kind as SourceResource['kind'],
    resourceKey: row.resource_key,
    acquisitionId: row.acquisition_id,
    ...(row.resource_id === null ? {} : { resourceId: row.resource_id }),
  };
}

export class SqliteResourceLedger implements ResourceLedgerStore {
  private readonly insertStmt: Statement;
  private readonly setIdStmt: Statement;
  private readonly removeStmt: Statement;
  private readonly liveByAcqStmt: Statement;
  private readonly allLiveStmt: Statement;

  constructor(
    db: EventDatabase,
    private readonly clock: Clock,
  ) {
    this.insertStmt = db.prepare(
      `INSERT INTO source_resources
         (source, kind, resource_key, resource_id, acquisition_id, created_at, removed_at)
       VALUES (@source, @kind, @resourceKey, @resourceId, @acquisitionId, @createdAt, NULL)
       ON CONFLICT (source, kind, resource_key, acquisition_id) DO NOTHING`,
    );
    this.setIdStmt = db.prepare(
      `UPDATE source_resources SET resource_id = @resourceId
       WHERE source = @source AND kind = @kind AND resource_key = @resourceKey
         AND acquisition_id = @acquisitionId`,
    );
    this.removeStmt = db.prepare(
      `UPDATE source_resources SET removed_at = @removedAt
       WHERE source = @source AND kind = @kind AND resource_key = @resourceKey
         AND acquisition_id = @acquisitionId`,
    );
    this.liveByAcqStmt = db.prepare(
      `SELECT * FROM source_resources WHERE acquisition_id = ? AND removed_at IS NULL`,
    );
    this.allLiveStmt = db.prepare(`SELECT * FROM source_resources WHERE removed_at IS NULL`);
  }

  recordCreated(resource: SourceResource): ResultAsync<void, InfraError> {
    try {
      this.insertStmt.run({
        source: resource.source,
        kind: resource.kind,
        resourceKey: resource.resourceKey,
        resourceId: resource.resourceId ?? null,
        acquisitionId: resource.acquisitionId,
        createdAt: this.clock.now().toISOString(),
      });
      return okAsync(undefined);
    } catch (err) {
      return errAsync(infraError('resource-ledger.recordCreated', errorMessage(err), err));
    }
  }

  recordId(key: SourceResourceKey, resourceId: string): ResultAsync<void, InfraError> {
    try {
      this.setIdStmt.run({ ...keyParams(key), resourceId });
      return okAsync(undefined);
    } catch (err) {
      return errAsync(infraError('resource-ledger.recordId', errorMessage(err), err));
    }
  }

  markRemoved(key: SourceResourceKey): ResultAsync<void, InfraError> {
    try {
      this.removeStmt.run({ ...keyParams(key), removedAt: this.clock.now().toISOString() });
      return okAsync(undefined);
    } catch (err) {
      return errAsync(infraError('resource-ledger.markRemoved', errorMessage(err), err));
    }
  }

  liveByAcquisition(acquisitionId: string): ResultAsync<readonly SourceResource[], InfraError> {
    try {
      const rows = this.liveByAcqStmt.all(acquisitionId) as ResourceRow[];
      return okAsync<readonly SourceResource[], InfraError>(rows.map(toResource));
    } catch (err) {
      return errAsync(infraError('resource-ledger.liveByAcquisition', errorMessage(err), err));
    }
  }

  allLive(): ResultAsync<readonly SourceResource[], InfraError> {
    try {
      const rows = this.allLiveStmt.all() as ResourceRow[];
      return okAsync<readonly SourceResource[], InfraError>(rows.map(toResource));
    } catch (err) {
      return errAsync(infraError('resource-ledger.allLive', errorMessage(err), err));
    }
  }
}

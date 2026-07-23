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

function keyParameters(key: SourceResourceKey): Record<string, string> {
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
    ...(row.resource_id !== null && { resourceId: row.resource_id }),
  };
}

export class SqliteResourceLedger implements ResourceLedgerStore {
  private readonly insertStmt: Statement;
  private readonly idAssignmentStmt: Statement;
  private readonly removalStmt: Statement;
  private readonly liveByAcqStmt: Statement;
  private readonly allLiveStmt: Statement;

  constructor(
    database: EventDatabase,
    private readonly clock: Clock,
  ) {
    this.insertStmt = database.prepare(
      `INSERT INTO source_resources
         (source, kind, resource_key, resource_id, acquisition_id, created_at, removed_at)
       VALUES (@source, @kind, @resourceKey, @resourceId, @acquisitionId, @createdAt, NULL)
       ON CONFLICT (source, kind, resource_key, acquisition_id) DO NOTHING`,
    );
    this.idAssignmentStmt = database.prepare(
      `UPDATE source_resources SET resource_id = @resourceId
       WHERE source = @source AND kind = @kind AND resource_key = @resourceKey
         AND acquisition_id = @acquisitionId`,
    );
    this.removalStmt = database.prepare(
      `UPDATE source_resources SET removed_at = @removedAt
       WHERE source = @source AND kind = @kind AND resource_key = @resourceKey
         AND acquisition_id = @acquisitionId`,
    );
    this.liveByAcqStmt = database.prepare(
      `SELECT * FROM source_resources WHERE acquisition_id = ? AND removed_at IS NULL`,
    );
    this.allLiveStmt = database.prepare(`SELECT * FROM source_resources WHERE removed_at IS NULL`);
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
    } catch (error) {
      return errAsync(infraError('resource-ledger.recordCreated', String(error), error));
    }
  }

  recordId(key: SourceResourceKey, resourceId: string): ResultAsync<void, InfraError> {
    try {
      this.idAssignmentStmt.run({ ...keyParameters(key), resourceId });
      return okAsync(undefined);
    } catch (error) {
      return errAsync(infraError('resource-ledger.recordId', String(error), error));
    }
  }

  markRemoved(key: SourceResourceKey): ResultAsync<void, InfraError> {
    try {
      this.removalStmt.run({ ...keyParameters(key), removedAt: this.clock.now().toISOString() });
      return okAsync(undefined);
    } catch (error) {
      return errAsync(infraError('resource-ledger.markRemoved', String(error), error));
    }
  }

  liveByAcquisition(acquisitionId: string): ResultAsync<readonly SourceResource[], InfraError> {
    try {
      const rows = this.liveByAcqStmt.all(acquisitionId) as ResourceRow[];
      return okAsync<readonly SourceResource[], InfraError>(rows.map((item) => toResource(item)));
    } catch (error) {
      return errAsync(infraError('resource-ledger.liveByAcquisition', String(error), error));
    }
  }

  allLive(): ResultAsync<readonly SourceResource[], InfraError> {
    try {
      const rows = this.allLiveStmt.all() as ResourceRow[];
      return okAsync<readonly SourceResource[], InfraError>(rows.map((item) => toResource(item)));
    } catch (error) {
      return errAsync(infraError('resource-ledger.allLive', String(error), error));
    }
  }
}

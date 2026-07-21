import type { ResultAsync } from 'neverthrow';
import type { InfraError } from './errors.js';

/**
 * The ownership ledger (D: source-resource stewardship): an adapter-private record of every resource
 * the app creates on a music source — searches and download transfers. Ownership is made explicit
 * here rather than inferred by name-matching, so the adapters act only on resources they created
 * (safe on a shared source instance) and a startup sweep can finish removals the app still owes. The
 * domain never sees it; it is infrastructure, like the reactor checkpoint.
 */
export type SourceResourceKind = 'search' | 'transfer';

/** Identifies one ledger row: a resource owned by one acquisition on one source. */
export interface SourceResourceKey {
  readonly source: string; // e.g. 'slskd'
  readonly kind: SourceResourceKind;
  readonly resourceKey: string; // a search id, or `${username}|${remoteFilename}` for a transfer
  readonly acquisitionId: string;
}

/** A recorded resource, carrying the source-assigned id once it is known. */
export interface SourceResource extends SourceResourceKey {
  readonly resourceId?: string; // the slskd GUID — transfers learn theirs on the first poll
}

export interface ResourceLedgerStore {
  /**
   * Record a resource the app created (or is about to), owned by its acquisition. Insert-if-absent,
   * so a retried write-ahead recording neither duplicates the row nor clobbers an id already learned.
   */
  recordCreated(resource: SourceResource): ResultAsync<void, InfraError>;
  /** Attach the source-assigned id to an already-recorded resource. */
  recordId(key: SourceResourceKey, resourceId: string): ResultAsync<void, InfraError>;
  /** Mark a resource removed from the source (its purpose served). Idempotent. */
  markRemoved(key: SourceResourceKey): ResultAsync<void, InfraError>;
  /** Every still-live resource owned by one acquisition. */
  liveByAcquisition(acquisitionId: string): ResultAsync<readonly SourceResource[], InfraError>;
  /** Every still-live resource across all acquisitions — the startup sweep's input. */
  allLive(): ResultAsync<readonly SourceResource[], InfraError>;
}

/**
 * Removes a recorded resource from the source (cancel-if-active, then delete). The startup sweep's
 * source-specific arm — the slskd adapter implements it — so the sweep itself stays source-agnostic.
 *
 * Resolves to whether the record is *confirmed gone*: cancelling an in-flight transfer only makes it
 * removable once it transitions to terminal, so a still-lingering record resolves `false` and the
 * sweep leaves its ledger row live to retry next boot, rather than marking a lingering record removed.
 */
export interface SourceResourceRemover {
  remove(resource: SourceResource): ResultAsync<boolean, InfraError>;
}

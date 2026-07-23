import { Import } from '../../domain/import/import.js';
import type { OpenReview } from '../../domain/import/import.js';
import type { ImportPhase } from '../../domain/import/import.js';
import type {
  ApplyFailure,
  CandidateRef,
  ImportEvent,
  ImportHints,
  ResolutionKind,
  ReviewKind,
} from '../../domain/import/events.js';
import { toImportId } from '../../domain/shared/import-id.js';
import type { ImportId } from '../../domain/shared/import-id.js';
import type { AcquisitionId } from '../../domain/shared/acquisition-id.js';
import type { StoredEvent } from '../ports/event-store-port.js';

/**
 * Read-model projections: each is a fold over the log and therefore rebuildable from it. The
 * status view carries the full narrative history (why a review was required, what the human chose);
 * the pending-reviews view is a filter over the same fold — one projection, two queries.
 */

/**
 * The kind-specific payload of a history entry. Each becomes a `StatusHistoryEntry` once tagged
 * with the occurrence time of the event it projects (see {@link StatusHistoryEntry}).
 */
type HistoryPayload =
  | { readonly kind: 'requested'; readonly hints?: ImportHints }
  | { readonly kind: 'proposed'; readonly candidateCount: number; readonly pinnedId?: string }
  | {
      readonly kind: 'auto-apply-selected';
      readonly candidate: CandidateRef;
      readonly distance: number;
    }
  | { readonly kind: 'review-required'; readonly reviewKind: ReviewKind }
  | { readonly kind: 'review-resolved'; readonly resolution: ResolutionKind }
  | { readonly kind: 'applied'; readonly location: string }
  | { readonly kind: 'remediation-required'; readonly failures: readonly ApplyFailure[] }
  | { readonly kind: 'rejected'; readonly reason: string; readonly filesDeleted: boolean }
  | {
      readonly kind: 'release-verdict-recorded';
      readonly acquisitionId: AcquisitionId;
      readonly reasons: readonly string[];
    };

/**
 * A history entry: its kind-specific payload plus `at`, the ISO-8601 occurrence time of the
 * underlying event. `at` lets a consumer order this import's history against another context's
 * (the acquisition timeline the web layer composes) in real time.
 */
export type StatusHistoryEntry = HistoryPayload & { readonly at: string };

export interface ImportStatusView {
  readonly importId: ImportId;
  /** The originating acquisition, when this import arrived from one — the web-side correlation key. */
  readonly acquisitionId?: string;
  readonly directory?: string;
  readonly phase: ImportPhase;
  readonly location?: string;
  readonly openReview?: OpenReview;
  readonly rejection?: { readonly reason: string; readonly filesDeleted: boolean };
  readonly history: readonly StatusHistoryEntry[];
}

/** One resolvable item of the pending-review queue, with its kind-specific carried context. */
export interface PendingReviewView {
  readonly importId: ImportId;
  readonly directory: string;
  readonly review: OpenReview;
}

function historyEntry(event: ImportEvent): HistoryPayload {
  switch (event.type) {
    case 'ImportRequested':
      return { kind: 'requested', hints: event.hints };
    case 'CandidatesProposed':
      return {
        kind: 'proposed',
        candidateCount: event.candidates.length,
        pinnedId: event.pinnedId,
      };
    case 'AutoApplySelected':
      return { kind: 'auto-apply-selected', candidate: event.ref, distance: event.distance };
    case 'ReviewRequired':
      return { kind: 'review-required', reviewKind: event.cause.kind };
    case 'ReviewResolved':
      return { kind: 'review-resolved', resolution: event.resolution.kind };
    case 'ImportApplied':
      return { kind: 'applied', location: event.location };
    case 'RemediationRequired':
      return { kind: 'remediation-required', failures: event.failures };
    case 'ImportRejected':
      return { kind: 'rejected', reason: event.reason, filesDeleted: event.filesDeleted };
    case 'ReleaseVerdictRecorded':
      return {
        kind: 'release-verdict-recorded',
        acquisitionId: event.acquisitionId,
        reasons: event.reasons,
      };
  }
}

/** The originating acquisition id, read from the request that opened the stream (if any). */
function acquisitionIdOf(events: readonly ImportEvent[]): string | undefined {
  const requested = events.find((event) => event.type === 'ImportRequested');
  return requested?.type === 'ImportRequested' ? requested.source?.acquisitionId : undefined;
}

export function projectStatus(
  importId: ImportId,
  stored: readonly StoredEvent[],
): ImportStatusView {
  const events = stored.map((entry) => entry.event);
  const snapshot = Import.fromHistory(events).snapshot;
  return {
    importId,
    acquisitionId: acquisitionIdOf(events),
    directory: snapshot.directory,
    phase: snapshot.phase,
    location: snapshot.location,
    openReview: snapshot.openReview,
    rejection: snapshot.rejection,
    history: stored.map((entry) => ({
      ...historyEntry(entry.event),
      at: entry.metadata.occurredAt,
    })),
  };
}

export class ImportStatusProjection {
  private readonly streams = new Map<ImportId, StoredEvent[]>();
  private readonly acquisitions = new Map<AcquisitionId, ImportId>();

  apply(stored: StoredEvent): void {
    // The event store speaks a generic streamId; the import read model reads it as the ImportId that
    // wrote the stream — the single ACL between the two, lifted once here.
    const importId = toImportId(stored.streamId);
    const list = this.streams.get(importId) ?? [];
    list.push(stored);
    this.streams.set(importId, list);
    if (stored.event.type === 'ImportRequested' && stored.event.source !== undefined) {
      this.acquisitions.set(stored.event.source.acquisitionId, importId);
    }
  }

  /**
   * The import an acquisition already submitted, if any — the durable idempotency check for the
   * intake seam consumer. Rebuilt from the log, so redelivery converges across restarts.
   */
  importIdForAcquisition(acquisitionId: AcquisitionId): ImportId | undefined {
    return this.acquisitions.get(acquisitionId);
  }

  get(importId: ImportId): ImportStatusView | undefined {
    const stored = this.streams.get(importId);
    return stored === undefined ? undefined : projectStatus(importId, stored);
  }

  list(): readonly ImportStatusView[] {
    return [...this.streams.entries()].map(([id, stored]) => projectStatus(id, stored));
  }

  /** Every import currently awaiting a human: typed review items with their carried context. */
  pendingReviews(): readonly PendingReviewView[] {
    return this.list().flatMap((view) =>
      view.openReview === undefined || view.directory === undefined
        ? []
        : [{ importId: view.importId, directory: view.directory, review: view.openReview }],
    );
  }

  rebuild(stored: readonly StoredEvent[]): void {
    this.streams.clear();
    this.acquisitions.clear();
    for (const entry of stored) this.apply(entry);
  }
}

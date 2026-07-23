import type { CandidateIdentity } from '../../domain/candidate/candidate.js';
import { Acquisition } from '../../domain/acquisition/acquisition.js';
import type { AcquisitionPhase } from '../../domain/acquisition/acquisition.js';
import type {
  AcquisitionEvent,
  DownloadFailureReason,
  EditionCandidate,
} from '../../domain/acquisition/events.js';
import type { ValidationReason } from '../../domain/validation/verdict.js';
import type { DownloadProgress } from '../ports/outbound-ports.js';
import type { DeadLetterStore } from '../ports/dead-letter-port.js';
import type { StoredEvent } from '../ports/event-store-port.js';
import type { Logger } from '../logging/logger.js';

/**
 * Read-model projections (D7): each is a fold over the log and therefore rebuildable from it.
 * Progress is the exception — it is ephemeral telemetry (D1) fed by the download adapter, never
 * from events, so it is not replayable.
 */

// --- Acquisition status ------------------------------------------------------------------------

/**
 * The kind-specific payload of a history entry. Each becomes a `StatusHistoryEntry` once tagged
 * with the occurrence time of the event it projects (see {@link StatusHistoryEntry}).
 */
type HistoryPayload =
  | { readonly kind: 'selected'; readonly candidate: CandidateIdentity }
  | {
      readonly kind: 'download-failed';
      readonly candidate: CandidateIdentity;
      readonly reason: DownloadFailureReason;
    }
  | {
      readonly kind: 'validation-failed';
      readonly candidate: CandidateIdentity;
      readonly reasons: readonly ValidationReason[];
    }
  | { readonly kind: 'imported'; readonly candidate: CandidateIdentity; readonly location: string }
  | {
      // A delivered candidate judged unacceptable by validation outside the system: the fulfilment
      // was rejected and the acquisition revived into the retry ladder.
      readonly kind: 'fulfillment-rejected';
      readonly candidate: CandidateIdentity;
      readonly reasons: readonly string[];
    };

/**
 * A history entry: its kind-specific payload plus `at`, the ISO-8601 occurrence time of the
 * underlying event. `at` lets a consumer order this acquisition's history against another
 * context's (the import timeline the web layer composes) in real time.
 */
export type StatusHistoryEntry = HistoryPayload & { readonly at: string };

export interface AcquisitionStatusView {
  readonly acquisitionId: string;
  readonly status: AcquisitionPhase;
  /** The human description of what is being acquired: resolved metadata, or the descriptor. */
  readonly target?: { readonly artist: string; readonly title: string };
  readonly currentCandidate?: CandidateIdentity;
  readonly attempts: number;
  readonly rejectedCount: number;
  readonly location?: string;
  readonly history: readonly StatusHistoryEntry[];
  /** The candidate editions on offer, present only while awaiting manual selection. */
  readonly candidates?: readonly EditionCandidate[];
  /**
   * Present (true) when the acquisition's current effect dead-lettered — its retry budget spent,
   * or a permanent fault, with no modeled failure to degrade to — awaiting an operator
   * (reactor-durability D2). Additive: absent for every acquisition progressing normally.
   */
  readonly stalled?: boolean;
}

/** The kind-specific payload for the events that surface as history — others yield nothing. */
function historyPayloadOf(event: AcquisitionEvent): HistoryPayload | undefined {
  switch (event.type) {
    case 'CandidateSelected':
      return { kind: 'selected', candidate: event.candidate.identity };
    case 'DownloadFailed':
      return { kind: 'download-failed', candidate: event.candidate, reason: event.reason };
    case 'ValidationFailed':
      return {
        kind: 'validation-failed',
        candidate: event.candidate,
        reasons: event.verdict.reasons,
      };
    case 'Imported':
      return { kind: 'imported', candidate: event.candidate, location: event.location };
    case 'FulfillmentRejected':
      return { kind: 'fulfillment-rejected', candidate: event.candidate, reasons: event.reasons };
    default:
      return undefined;
  }
}

export function projectStatus(
  acquisitionId: string,
  stored: readonly StoredEvent[],
): AcquisitionStatusView {
  const events = stored.map((entry) => entry.event);
  const snapshot = Acquisition.fromHistory(events).snapshot;
  const history: StatusHistoryEntry[] = [];
  let target: { artist: string; title: string } | undefined;
  for (const event of events) {
    if (event.type === 'AcquisitionRequested' && event.request.kind === 'descriptor') {
      target = { artist: event.request.artist, title: event.request.title };
    } else if (event.type === 'TargetResolved') {
      target = { artist: event.target.artist, title: event.target.title };
    }
  }
  for (const entry of stored) {
    const payload = historyPayloadOf(entry.event);
    if (payload !== undefined) history.push({ ...payload, at: entry.metadata.occurredAt });
  }
  return {
    acquisitionId,
    status: snapshot.phase,
    target,
    currentCandidate: snapshot.currentCandidate,
    attempts: snapshot.attempts,
    rejectedCount: snapshot.rejectedCount,
    location: snapshot.location,
    history,
    candidates: snapshot.candidates,
  };
}

export class AcquisitionStatusProjection {
  private readonly streams = new Map<string, StoredEvent[]>();

  apply(stored: StoredEvent): void {
    const list = this.streams.get(stored.streamId) ?? [];
    list.push(stored);
    this.streams.set(stored.streamId, list);
  }

  get(acquisitionId: string): AcquisitionStatusView | undefined {
    const stored = this.streams.get(acquisitionId);
    return stored === undefined ? undefined : projectStatus(acquisitionId, stored);
  }

  list(): readonly AcquisitionStatusView[] {
    return [...this.streams.entries()].map(([id, stored]) => projectStatus(id, stored));
  }

  rebuild(stored: readonly StoredEvent[]): void {
    this.streams.clear();
    for (const entry of stored) this.apply(entry);
  }
}

// --- Stalled acquisitions (reactor-durability D2/D5) -------------------------------------------

/**
 * The in-memory face of the reactor's dead-lettered effects: seeded from the dead-letter store at
 * boot, marked/cleared by the reactor as effects dead-letter or their streams resume. In-memory
 * (like {@link ProgressReadModel}) because the facade's queries are synchronous; the durable truth
 * stays in the dead-letter store.
 */
export class StalledReadModel {
  private readonly stalled = new Set<string>();

  mark(acquisitionId: string): void {
    this.stalled.add(acquisitionId);
  }

  clear(acquisitionId: string): void {
    this.stalled.delete(acquisitionId);
  }

  isStalled(acquisitionId: string): boolean {
    return this.stalled.has(acquisitionId);
  }
}

/**
 * Boot-time retention + seeding (reactor-durability D2): prune dead letters older than the
 * horizon, then load the survivors' stream ids into the in-memory exposure. Either store fault is
 * logged, never fatal: a failed prune over-retains (aged letters stay marked), a failed list
 * serves the boot unmarked — the truth stays in the store and the next boot retries.
 */
export async function seedStalledReadModel(
  deadLetters: DeadLetterStore,
  stalled: StalledReadModel,
  subscription: string,
  horizonIso: string,
  logger: Logger,
): Promise<void> {
  const pruned = await deadLetters.prune(subscription, horizonIso);
  if (pruned.isErr()) logger.warn({ err: pruned.error }, 'stalled retention prune failed');
  const letters = await deadLetters.list(subscription);
  if (letters.isErr()) {
    logger.error({ err: letters.error }, 'stalled read-model seed failed');
    return;
  }
  for (const letter of letters.value) {
    if (letter.streamId !== undefined) stalled.mark(letter.streamId);
  }
}

// --- Download progress (ephemeral read model, D1) ----------------------------------------------

export class ProgressReadModel {
  private readonly progress = new Map<string, DownloadProgress>();

  update(acquisitionId: string, progress: DownloadProgress): void {
    this.progress.set(acquisitionId, progress);
  }

  get(acquisitionId: string): DownloadProgress | undefined {
    return this.progress.get(acquisitionId);
  }
}

// --- Library view ------------------------------------------------------------------------------

export interface LibraryEntry {
  readonly acquisitionId: string;
  readonly artist: string;
  readonly title: string;
  readonly location: string;
}

export class LibraryViewProjection {
  private readonly entries: LibraryEntry[] = [];
  private readonly targets = new Map<string, { artist: string; title: string }>();

  apply(stored: StoredEvent): void {
    const event = stored.event;
    if (event.type === 'TargetResolved') {
      this.targets.set(stored.streamId, { artist: event.target.artist, title: event.target.title });
    } else if (event.type === 'Imported') {
      // An import is only ever emitted after its target resolved, so the lookup holds in practice;
      // guard it anyway rather than assert, so a future ordering change degrades to a skipped entry
      // instead of a crash.
      const target = this.targets.get(stored.streamId);
      if (target === undefined) return;
      this.entries.push({
        acquisitionId: stored.streamId,
        artist: target.artist,
        title: target.title,
        location: event.location,
      });
    }
  }

  list(): readonly LibraryEntry[] {
    return [...this.entries];
  }
}

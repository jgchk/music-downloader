import { ResultAsync } from 'neverthrow';
import type { Candidate } from '../../domain/candidate/candidate.js';
import type { Target } from '../../domain/target/target.js';
import { infraError } from '../../application/ports/errors.js';
import type { InfraError } from '../../application/ports/errors.js';
import type { SearchPort } from '../../application/ports/outbound-ports.js';
import type {
  ResourceLedgerStore,
  SourceResourceKey,
} from '../../application/ports/resource-ledger-port.js';
import type { Logger } from '../../application/logging/logger.js';
import { SlskdClient } from './client.js';
import type { SlskdConfig } from './client.js';
import { mapSearchResponses } from './mapping.js';
import { slskdSearchResponsesSchema, slskdSearchStateSchema } from './schemas.js';
import type { SlskdSearchState } from './schemas.js';
import { realTimer } from './timer.js';
import type { Timer } from './timer.js';

/**
 * The slskd `SearchPort` adapter (D11). A search is created, polled until slskd confirms it
 * complete, and its responses are grouped into source-agnostic candidates at the target's
 * granularity. Only a confirmed-complete, self-consistent harvest is trusted: slskd (observed on
 * 0.22.5) counts responses as they arrive but persists them only at finalization, so a search
 * still in progress at the deadline — or a harvest that returns nothing while the search's own
 * `responseCount` says responses exist — is a truncated read and surfaces as a retryable
 * `InfraError`, never as an empty result (harvest integrity). An empty harvest from a
 * confirmed-complete search remains a valid `Ok` business fact. The deadline sits well above
 * slskd's own default search duration (~15s), so the fault path is the exception.
 *
 * The search is recorded in the ownership ledger and deleted from slskd once harvested. A faulted
 * search is never deleted inline — a still-running search would be corrupted by the delete, and a
 * contradicted (finalized) harvest is kept for diagnosis — its live ledger row leaves it to the
 * startup sweep (D: source-resource stewardship). Ledger bookkeeping and the delete are
 * best-effort: a failure is logged and never fails a working search.
 */

const DEFAULT_POLL_INTERVAL_MS = 1000;
const DEFAULT_SEARCH_TIMEOUT_MS = 60_000;
const SLSKD_SOURCE = 'slskd';

export class SlskdSearch implements SearchPort {
  private readonly client: SlskdClient;
  private readonly pollIntervalMs: number;
  private readonly searchTimeoutMs: number;

  constructor(
    private readonly logger: Logger,
    private readonly ledger: ResourceLedgerStore,
    client: SlskdClient = new SlskdClient(),
    private readonly timer: Timer = realTimer,
    config: SlskdConfig = {},
  ) {
    this.client = client;
    this.pollIntervalMs = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.searchTimeoutMs = config.searchTimeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS;
  }

  search(
    acquisitionId: string,
    target: Target,
    round: number,
  ): ResultAsync<readonly Candidate[], InfraError> {
    return ResultAsync.fromPromise(this.doSearch(acquisitionId, target, round), (cause) =>
      infraError('slskd.search', String(cause), cause),
    );
  }

  private async doSearch(
    acquisitionId: string,
    target: Target,
    round: number,
  ): Promise<readonly Candidate[]> {
    const searchText = buildQuery(target);
    this.logger.debug({ searchText, round }, 'creating slskd search');
    const created = slskdSearchStateSchema.parse(
      await this.client.post('/api/v0/searches', { searchText }),
    );
    if (created.id === undefined || created.id === '') {
      // An id-less create is an incoherent read: the search may exist server-side but could never
      // be polled, harvested, or swept — fault loudly rather than track a resource by ''.
      throw new Error('slskd search create returned no search id');
    }
    const id = created.id;
    const key: SourceResourceKey = {
      source: SLSKD_SOURCE,
      kind: 'search',
      resourceKey: id,
      acquisitionId,
    };
    await this.bestEffort(this.ledger.recordCreated({ ...key, resourceId: id }), 'record search');
    const state = await this.awaitCompletion(id);
    this.ensureConfirmedComplete(id, round, state);
    const responses = slskdSearchResponsesSchema.parse(
      await this.client.get(`/api/v0/searches/${encodeURIComponent(id)}/responses`),
    );
    this.ensureHarvestConsistent(id, round, state, responses);
    const candidates = mapSearchResponses(responses, target.type);
    await this.deleteSearch(id, key);
    this.logger.debug({ round, candidateCount: candidates.length }, 'slskd search complete');
    return candidates;
  }

  /** Harvest gate 1: only a search slskd has confirmed complete may be harvested. */
  private ensureConfirmedComplete(id: string, round: number, state: SlskdSearchState): void {
    if (state.isComplete === true) return;
    this.logger.warn(
      { id, round, state: state.state, responseCount: state.responseCount },
      'slskd search still incomplete at deadline; faulting and leaving it for the sweep',
    );
    throw new Error(
      `slskd search ${id} incomplete after ${String(this.searchTimeoutMs)}ms ` +
        `(state=${state.state ?? 'unknown'}, responseCount=${String(state.responseCount ?? 'unknown')})`,
    );
  }

  /**
   * Harvest gate 2: a harvest that returns nothing while slskd's own bookkeeping counted
   * responses is truncated. An absent `responseCount` disarms the gate (tolerant reader) — worth
   * a warn, since a slskd upgrade dropping the field would otherwise fail open invisibly.
   */
  private ensureHarvestConsistent(
    id: string,
    round: number,
    state: SlskdSearchState,
    responses: readonly unknown[],
  ): void {
    if (state.responseCount === undefined) {
      this.logger.warn(
        { id, round },
        'slskd search state omits responseCount; the harvest-consistency gate is disarmed',
      );
      return;
    }
    if (state.responseCount === 0 || responses.length > 0) return;
    this.logger.warn(
      { id, round, responseCount: state.responseCount },
      'slskd harvest contradicts the search state; faulting and leaving it for the sweep',
    );
    throw new Error(
      `slskd search ${id} reported ${String(state.responseCount)} responses but the harvest returned none`,
    );
  }

  /** Delete the harvested search from slskd and mark the ledger row removed; failures are logged. */
  private async deleteSearch(id: string, key: SourceResourceKey): Promise<void> {
    try {
      await this.client.delIfPresent(`/api/v0/searches/${encodeURIComponent(id)}`);
    } catch (error) {
      this.logger.warn(
        { err: error, id },
        'failed to delete slskd search; leaving it for the sweep',
      );
      return;
    }
    await this.bestEffort(this.ledger.markRemoved(key), 'mark search removed');
  }

  /** Run a ledger write without letting a stewardship fault fail an otherwise-working search. */
  private async bestEffort(op: ResultAsync<void, InfraError>, what: string): Promise<void> {
    const result = await op;
    if (result.isErr()) this.logger.warn({ err: result.error }, `ledger: ${what} failed`);
  }

  /** Poll until slskd confirms completion or the deadline passes; returns the last observed state. */
  private async awaitCompletion(id: string): Promise<SlskdSearchState> {
    const deadline = this.timer.now() + this.searchTimeoutMs;
    for (;;) {
      const state = slskdSearchStateSchema.parse(
        await this.client.get(`/api/v0/searches/${encodeURIComponent(id)}`),
      );
      if (state.isComplete === true) return state;
      if (this.timer.now() >= deadline) return state;
      await this.timer.sleep(this.pollIntervalMs);
    }
  }
}

/** A source-agnostic query from the normalized target: artist plus album/track title. */
export function buildQuery(target: Target): string {
  return `${target.artist} ${target.title}`.trim();
}

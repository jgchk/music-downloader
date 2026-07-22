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
import { realTimer } from './timer.js';
import type { Timer } from './timer.js';

/**
 * The slskd `SearchPort` adapter (D11). A search is created, polled until slskd reports it complete
 * or a timeout elapses, and its responses are grouped into source-agnostic candidates at the
 * target's granularity. An empty result is a valid `Ok` (a business fact, not an infra fault); only
 * transport faults, unexpected HTTP statuses, or contract-violating bodies surface as an
 * `InfraError` (D2 — responses are validated against the contract schema before mapping).
 *
 * The search is recorded in the ownership ledger and deleted from slskd once harvested — on both the
 * completed and timed-out exits (a timed-out search would otherwise keep running server-side). Ledger
 * bookkeeping and the delete are best-effort: a failure is logged, never fails a working search, and
 * a still-live ledger row is retired by the startup sweep (D: source-resource stewardship).
 */

const DEFAULT_POLL_INTERVAL_MS = 1_000;
const DEFAULT_SEARCH_TIMEOUT_MS = 15_000;
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
    const id = created.id ?? '';
    const key: SourceResourceKey = {
      source: SLSKD_SOURCE,
      kind: 'search',
      resourceKey: id,
      acquisitionId,
    };
    await this.bestEffort(this.ledger.recordCreated({ ...key, resourceId: id }), 'record search');
    await this.awaitCompletion(id);
    const responses = slskdSearchResponsesSchema.parse(
      await this.client.get(`/api/v0/searches/${encodeURIComponent(id)}/responses`),
    );
    const candidates = mapSearchResponses(responses, target.type);
    await this.deleteSearch(id, key);
    this.logger.debug({ round, candidateCount: candidates.length }, 'slskd search complete');
    return candidates;
  }

  /** Delete the harvested search from slskd and mark the ledger row removed; failures are logged. */
  private async deleteSearch(id: string, key: SourceResourceKey): Promise<void> {
    try {
      await this.client.delIfPresent(`/api/v0/searches/${encodeURIComponent(id)}`);
    } catch (err) {
      this.logger.warn({ err, id }, 'failed to delete slskd search; leaving it for the sweep');
      return;
    }
    await this.bestEffort(this.ledger.markRemoved(key), 'mark search removed');
  }

  /** Run a ledger write without letting a stewardship fault fail an otherwise-working search. */
  private async bestEffort(op: ResultAsync<void, InfraError>, what: string): Promise<void> {
    const result = await op;
    if (result.isErr()) this.logger.warn({ err: result.error }, `ledger: ${what} failed`);
  }

  private async awaitCompletion(id: string): Promise<void> {
    const deadline = this.timer.now() + this.searchTimeoutMs;
    for (;;) {
      const state = slskdSearchStateSchema.parse(
        await this.client.get(`/api/v0/searches/${encodeURIComponent(id)}`),
      );
      if (state.isComplete === true) return;
      if (this.timer.now() >= deadline) return;
      await this.timer.sleep(this.pollIntervalMs);
    }
  }
}

/** A source-agnostic query from the normalized target: artist plus album/track title. */
export function buildQuery(target: Target): string {
  return `${target.artist} ${target.title}`.trim();
}

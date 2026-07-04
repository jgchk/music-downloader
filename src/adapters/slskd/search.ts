import { ResultAsync } from 'neverthrow';
import type { Candidate } from '../../domain/candidate/candidate.js';
import type { Target } from '../../domain/target/target.js';
import { infraError } from '../../application/ports/errors.js';
import type { InfraError } from '../../application/ports/errors.js';
import type { SearchPort } from '../../application/ports/outbound-ports.js';
import type { Logger } from '../../application/logging/logger.js';
import { SlskdClient } from './client.js';
import type { SlskdConfig } from './client.js';
import { mapSearchResponses } from './mapping.js';
import { realTimer } from './timer.js';
import type { Timer } from './timer.js';

/**
 * The slskd `SearchPort` adapter (D11). A search is created, polled until slskd reports it complete
 * or a timeout elapses, and its responses are grouped into source-agnostic candidates at the
 * target's granularity. An empty result is a valid `Ok` (a business fact, not an infra fault); only
 * transport faults or unexpected HTTP statuses surface as an `InfraError`.
 */

const DEFAULT_POLL_INTERVAL_MS = 1_000;
const DEFAULT_SEARCH_TIMEOUT_MS = 15_000;

interface SlskdSearchState {
  readonly id?: string;
  readonly isComplete?: boolean;
}

export class SlskdSearch implements SearchPort {
  private readonly client: SlskdClient;
  private readonly pollIntervalMs: number;
  private readonly searchTimeoutMs: number;

  constructor(
    private readonly logger: Logger,
    client: SlskdClient = new SlskdClient(),
    private readonly timer: Timer = realTimer,
    config: SlskdConfig = {},
  ) {
    this.client = client;
    this.pollIntervalMs = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.searchTimeoutMs = config.searchTimeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS;
  }

  search(target: Target, round: number): ResultAsync<readonly Candidate[], InfraError> {
    return ResultAsync.fromPromise(this.doSearch(target, round), (cause) =>
      infraError('slskd.search', String(cause), cause),
    );
  }

  private async doSearch(target: Target, round: number): Promise<readonly Candidate[]> {
    const searchText = buildQuery(target);
    this.logger.debug({ searchText, round }, 'creating slskd search');
    const created = (await this.client.post('/api/v0/searches', {
      searchText,
    })) as SlskdSearchState;
    const id = created.id ?? '';
    await this.awaitCompletion(id);
    const responses = await this.client.get(`/api/v0/searches/${encodeURIComponent(id)}/responses`);
    const candidates = mapSearchResponses(responses, target.type);
    this.logger.debug({ round, candidateCount: candidates.length }, 'slskd search complete');
    return candidates;
  }

  private async awaitCompletion(id: string): Promise<void> {
    const deadline = this.timer.now() + this.searchTimeoutMs;
    for (;;) {
      const state = (await this.client.get(
        `/api/v0/searches/${encodeURIComponent(id)}`,
      )) as SlskdSearchState;
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

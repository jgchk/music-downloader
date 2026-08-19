import {
  DRIFT_EXIT_CODES,
  probe,
  worstOutcome,
  type DriftOutcome,
} from '../../../../../scripts/drift/probe.js';
import { loadFixtures } from '../support/fixture.js';
import { fixtureSchemas } from '../support/registry.js';

/**
 * Tier-2 drift check for MusicBrainz (task 5.2). Replays the exact request set the fixtures were
 * recorded from against the live service and validates each response with the same contract schema
 * the runtime adapter enforces. Value-level change (tags, ratings, freshly-added releases) is not
 * drift — only a consumed field going missing or changing type is, which is precisely what schema
 * validation catches. Anonymous, ≤1 req/s with a descriptive User-Agent.
 *
 * Each replay lands in one of three outcomes and the process exit code carries the run's worst
 * (change: drift-signal-fidelity): `0` conforms, `1` drift, `2` unavailable. The split matters
 * because MusicBrainz rate-limits per IP and GitHub-hosted runners share their egress with every
 * other Actions customer, so a 503 here is a statement about the runner, not about the contract —
 * issue #184 was exactly that, reported as drift. A removed operation (404/410) or an endpoint
 * that grew an auth requirement stays drift; see `scripts/drift/probe.ts` for the full split.
 */

const BASE_URL = process.env.MUSICBRAINZ_BASE_URL ?? 'https://musicbrainz.org/ws/2';
/**
 * MusicBrainz asks anonymous clients to identify themselves with a contactable location, and
 * enforces it with throttling. This pointed at `github.com/anthropics/music-downloader` — a
 * repository that does not exist — until drift-signal-fidelity; a dead URL is not politeness
 * theatre, it is a reason to be throttled, and this job is what suffers for it.
 */
const USER_AGENT =
  process.env.MUSICBRAINZ_USER_AGENT ??
  'music-downloader-drift/1.0 (https://github.com/jgchk/music-downloader)';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const fixtures = loadFixtures('musicbrainz');
  const outcomes: DriftOutcome[] = [];
  const drifts: string[] = [];
  const unreached: string[] = [];

  for (const { name, fixture } of fixtures) {
    const schema = fixtureSchemas[`musicbrainz/${name}`];
    if (schema === undefined) continue;
    const query = new URLSearchParams(fixture.request.query).toString();
    const url = `${BASE_URL}${fixture.request.path}?${query}`;
    const where = `${name} (${fixture.request.path})`;

    const result = await probe(() =>
      fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } }),
    );
    await sleep(1100); // ≥1 req/s

    if (result.kind === 'unavailable') {
      outcomes.push('unavailable');
      unreached.push(`${name}: ${result.reason}`);
      console.log(`? ${where} — not verified: ${result.reason}`);
      continue;
    }

    // Reached, but not with a body: the operation the adapter depends on answered something it
    // never answered when the fixture was recorded. That is the consumed surface changing.
    if (!result.response.ok) {
      outcomes.push('drift');
      drifts.push(`${name}: HTTP ${result.response.status} for ${fixture.request.path}`);
      console.log(`✗ ${where} — HTTP ${result.response.status}`);
      continue;
    }

    const parsed = schema.safeParse(await result.response.json());
    if (parsed.success) {
      outcomes.push('conforms');
      console.log(`✓ ${where}`);
    } else {
      const paths = parsed.error.issues.map((i) => i.path.join('.') || '(root)').join(', ');
      outcomes.push('drift');
      drifts.push(`${name}: schema violation at [${paths}]`);
      console.log(`✗ ${where} — schema violation`);
    }
  }

  const outcome = worstOutcome(outcomes);
  if (drifts.length > 0) {
    console.error(`\n✗ MusicBrainz contract drift (${drifts.length}):`);
    for (const drift of drifts) console.error(`  - ${drift}`);
  }
  if (unreached.length > 0) {
    console.error(`\n? MusicBrainz not verified (${unreached.length} of ${outcomes.length}):`);
    for (const reason of unreached) console.error(`  - ${reason}`);
  }
  if (outcome === 'conforms') {
    console.log('\n✓ live MusicBrainz responses conform to the contract');
  } else if (outcome === 'unavailable') {
    console.log(
      '\n? MusicBrainz was not fully reachable — the contract is neither confirmed nor refuted',
    );
  }

  process.exit(DRIFT_EXIT_CODES[outcome]);
}

void main();

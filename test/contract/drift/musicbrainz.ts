import { loadFixtures } from '../support/fixture.js';
import { fixtureSchemas } from '../support/registry.js';

/**
 * Tier-2 drift check for MusicBrainz (task 5.2). Replays the exact request set the fixtures were
 * recorded from against the live service and validates each response with the same contract schema
 * the runtime adapter enforces. Value-level change (tags, ratings, freshly-added releases) is not
 * drift — only a consumed field going missing or changing type is, which is precisely what schema
 * validation catches. Anonymous, ≤1 req/s with a descriptive User-Agent, one retry with backoff.
 * Exits non-zero on any violation, naming the request and the failing schema path.
 */

const BASE_URL = process.env.MUSICBRAINZ_BASE_URL ?? 'https://musicbrainz.org/ws/2';
const USER_AGENT =
  process.env.MUSICBRAINZ_USER_AGENT ??
  'music-downloader-drift/0.0 (https://github.com/anthropics/music-downloader)';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url: string): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    });
    if (response.ok || attempt >= 1) return response;
    await sleep(2000); // one retry with backoff (rate limit / transient)
  }
}

async function main(): Promise<void> {
  const fixtures = loadFixtures('musicbrainz');
  const failures: string[] = [];

  for (const { name, fixture } of fixtures) {
    const schema = fixtureSchemas[`musicbrainz/${name}`];
    if (schema === undefined) continue;
    const query = new URLSearchParams(fixture.request.query).toString();
    const url = `${BASE_URL}${fixture.request.path}?${query}`;

    const response = await fetchWithRetry(url);
    await sleep(1100); // ≥1 req/s
    if (!response.ok) {
      failures.push(`${name}: HTTP ${response.status} for ${fixture.request.path}`);
      continue;
    }
    const result = schema.safeParse(await response.json());
    if (result.success) {
      console.log(`✓ ${name} (${fixture.request.path})`);
    } else {
      const paths = result.error.issues.map((i) => i.path.join('.') || '(root)').join(', ');
      failures.push(`${name}: schema violation at [${paths}]`);
    }
  }

  if (failures.length > 0) {
    console.error(`\n✗ MusicBrainz contract drift (${failures.length}):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('\n✓ live MusicBrainz responses conform to the contract');
}

void main();

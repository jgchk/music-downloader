import { readFileSync } from 'node:fs';
import { SLSKD_CONSUMED_OPERATIONS } from '../support/slskd-manifest.js';
import { checkSlskdSpec } from '../support/spec-compat.js';

/**
 * Tier-2 drift check for slskd (task 5.1). Fetches the OpenAPI document of a running slskd — the
 * drift workflow boots `slskd/slskd:latest` with `SLSKD_SWAGGER=true` and points `SLSKD_SPEC_URL`
 * at it — and runs the consumed-surface manifest against it. It first re-confirms the manifest
 * still holds against the committed pinned snapshot (a self-check), then reports the pinned→latest
 * delta for the surface we depend on. Exits non-zero if the live spec drops or reshapes anything we
 * consume, so the workflow can raise a drift issue.
 *
 *   SLSKD_SPEC_URL=http://localhost:5030/swagger/v0/swagger.json \
 *   SLSKD_LATEST_LABEL=latest pnpm tsx test/contract/drift/slskd.ts
 */

const SPEC_URL = process.env.SLSKD_SPEC_URL ?? 'http://localhost:5030/swagger/v0/swagger.json';
const LATEST_LABEL = process.env.SLSKD_LATEST_LABEL ?? 'latest';
const SPEC_DIR = new URL('../slskd-spec/', import.meta.url).pathname;

async function main(): Promise<void> {
  const provenance = JSON.parse(readFileSync(`${SPEC_DIR}provenance.json`, 'utf8')) as {
    specPath: string;
    pinnedVersion: string;
  };
  const pinnedSpec = JSON.parse(readFileSync(`${SPEC_DIR}${provenance.specPath}`, 'utf8'));

  const pinnedViolations = checkSlskdSpec(pinnedSpec, SLSKD_CONSUMED_OPERATIONS);
  if (pinnedViolations.length > 0) {
    console.error('BUG: manifest does not hold against its own pinned snapshot:');
    console.error(JSON.stringify(pinnedViolations, null, 2));
    process.exit(2);
  }

  console.log(`fetching latest slskd spec from ${SPEC_URL} …`);
  const response = await fetch(SPEC_URL);
  if (!response.ok) {
    console.error(`could not fetch latest spec: HTTP ${response.status}`);
    process.exit(2);
  }
  const latestSpec = JSON.parse(await response.text());

  // Guard against a half-ready or wrong endpoint: an (almost) empty paths object is an environment
  // fault, not "every operation we consume vanished". Fail as an error (2), not a drift signal (1).
  const pathCount = Object.keys(latestSpec?.paths ?? {}).length;
  if (pathCount < 10) {
    console.error(`fetched spec has only ${pathCount} paths — looks empty/unready, not real drift`);
    process.exit(2);
  }

  const violations = checkSlskdSpec(latestSpec, SLSKD_CONSUMED_OPERATIONS);
  console.log(
    `\nslskd consumed-surface drift: pinned ${provenance.pinnedVersion} → ${LATEST_LABEL}`,
  );
  if (violations.length === 0) {
    console.log('✓ every consumed operation still present with a compatible shape');
    return;
  }
  console.error(`✗ ${violations.length} breaking change(s) on the consumed surface:`);
  for (const v of violations) console.error(`  - ${v.operation}: ${v.problem}`);
  process.exit(1);
}

void main();

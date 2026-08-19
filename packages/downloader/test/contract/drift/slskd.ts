import { readFileSync } from 'node:fs';
import { DRIFT_EXIT_CODES, probe } from '../../../../../scripts/drift/probe.js';
import { SLSKD_CONSUMED_OPERATIONS } from '../support/slskd-manifest.js';
import { checkSlskdSpec } from '../support/spec-compat.js';
import type { OpenApiSpec } from '../support/spec-compat.js';

/**
 * Tier-2 drift check for slskd (task 5.1). Fetches the OpenAPI document of a running slskd — the
 * drift workflow boots `slskd/slskd:latest` with `SLSKD_SWAGGER=true` and points `SLSKD_SPEC_URL`
 * at it — and runs the consumed-surface manifest against it. It first re-confirms the manifest
 * still holds against the committed pinned snapshot (a self-check), then reports the pinned→latest
 * delta for the surface we depend on.
 *
 * This check has always separated "the consumed surface broke" from "the environment did not give
 * me a spec to read" by exit code; drift-signal-fidelity is where the workflow finally *honours*
 * that split rather than collapsing both into a red run and a tracking issue. `1` is the loud
 * channel (drift, or a checker that contradicts itself), `2` the quiet one (unavailable).
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
  const pinnedSpec = JSON.parse(
    readFileSync(`${SPEC_DIR}${provenance.specPath}`, 'utf8'),
  ) as OpenApiSpec;

  const pinnedViolations = checkSlskdSpec(pinnedSpec, SLSKD_CONSUMED_OPERATIONS);
  if (pinnedViolations.length > 0) {
    // A checker that contradicts its own committed evidence is broken, and a broken checker is the
    // loud channel — quietly skipping the week is how #110 would have gone unnoticed.
    console.error('BUG: manifest does not hold against its own pinned snapshot:');
    console.error(JSON.stringify(pinnedViolations, null, 2));
    process.exit(DRIFT_EXIT_CODES.drift);
  }

  console.log(`fetching latest slskd spec from ${SPEC_URL} …`);
  const fetched = await probe(() => fetch(SPEC_URL));
  if (fetched.kind === 'unavailable') {
    console.error(`could not fetch latest spec: ${fetched.reason}`);
    process.exit(DRIFT_EXIT_CODES.unavailable);
  }
  if (!fetched.response.ok) {
    console.error(`could not fetch latest spec: HTTP ${fetched.response.status}`);
    process.exit(DRIFT_EXIT_CODES.unavailable);
  }
  const latestSpec = JSON.parse(await fetched.response.text()) as OpenApiSpec | null;

  // Guard against a half-ready or wrong endpoint: an (almost) empty paths object is an environment
  // fault, not "every operation we consume vanished" — unavailable, never a drift signal.
  const pathCount = Object.keys(latestSpec?.paths ?? {}).length;
  if (latestSpec === null || pathCount < 10) {
    console.error(`fetched spec has only ${pathCount} paths — looks empty/unready, not real drift`);
    process.exit(DRIFT_EXIT_CODES.unavailable);
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
  process.exit(DRIFT_EXIT_CODES.drift);
}

void main();

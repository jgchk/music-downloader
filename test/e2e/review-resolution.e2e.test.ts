import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BASE_URL,
  DEPOSIT_DIR,
  DOWNLOADER_DB,
  IMPORTER_DB,
  LIBRARY_DIR,
  MBID,
  STAGED_SUBDIR,
  countEvents,
  pollForEvent,
  pollForStatus,
  seedFixture,
  sessionCookieHeader,
  submitAcquisition,
  waitForOk,
} from './helpers.js';

/**
 * The review-resolution revival loop (e2e-review-resolution-loop): a genuinely low-confidence
 * import — REAL beets scoring the seeded review-band fixture into the band between the
 * auto-apply threshold and no-match — queues a human review; resolving it over HTTP as
 * `reject-unusable-delivery` publishes the verdict across the store seam; the downloader
 * consumes it, revives the hunt WITHOUT a new submission, delivers a second candidate, and the
 * story completes into the library. This is the one resolution path whose cross-context half no
 * other tier exercises (the accepting path's outcome — ImportApplied, read cross-store by the
 * web composition — is what the full-loop phase's auto-apply already proves).
 *
 * Determinism comes from fixture engineering, not configuration: this phase adds no
 * scenario-special configuration — the AUTO_APPLY_THRESHOLD is the same one every other phase
 * runs (test/e2e/README.md's caveats document its derisking vs. the production default) — and
 * the seeded tags are
 * calibrated against the image's pinned beets (fixtures/README.md carries the recipe, the pin,
 * and the measured distance). The setup probe asserts the review actually queued — a beets bump
 * that moves the scoring band fails THERE, loudly naming the premise, never silently degrading
 * the scenario into an auto-apply pass.
 *
 * The resolution is posted with a GUEST session minted by the production codec — asserting in
 * passing that review resolution requires no privilege (auth-roles: the base interface is
 * role-independent). The second candidate rides an ad-hoc stateful WireMock script (the
 * Hold-scenario mechanism): round one replays the on-disk answers (search-1 / peer1 /
 * transfer-1; the scripted round-one search-create is a pinned replica that only arms the
 * scenario); the revival's search returns search-2, which HOLDS incomplete until the phase
 * has witnessed the rejection's cleanup contract — the deposited first delivery deleted (D4) —
 * race-free, then completes into peer2's alternative release and auto-applies cleanly. The
 * hold sits at the SEARCH stage deliberately: a byte-frozen in-progress transfer would trip
 * the download supervisor's stall watch and burn the candidate.
 */

const SLSKD_ADMIN = process.env.E2E_SLSKD_ADMIN_URL ?? 'http://localhost:8082/__admin';

/** Candidate B's staged subdir (stubs/slskd/scripted): it differs from candidate A in
 *  username, path, AND size — the downloader's rejected-candidate dedupe keys on that triple,
 *  so an identical re-offer would (correctly) never be re-tried. */
const ALT_SUBDIR = 'Test Album (Alt)';
const DEPOSIT_RELEASE_DIR = path.join(DEPOSIT_DIR, 'Test_Artist', 'Test_Album_(2020)');

async function admin(method: string, path: string, body?: unknown): Promise<Response> {
  const res = await fetch(`${SLSKD_ADMIN}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path} returned ${res.status}`);
  return res;
}

/** The stub's request journal: how many times the app enqueued a download with this peer. */
async function enqueueCount(peer: string): Promise<number> {
  const res = await admin('POST', '/requests/count', {
    method: 'POST',
    urlPath: `/api/v0/transfers/downloads/${peer}`,
  });
  return ((await res.json()) as { count: number }).count;
}

async function slskdDeletes(): Promise<string[]> {
  const res = await admin('GET', '/requests');
  const body = (await res.json()) as { requests: { request: { method: string; url: string } }[] };
  return body.requests
    .map((entry) => entry.request)
    .filter((request) => request.method === 'DELETE')
    .map((request) => request.url);
}

async function pollUntil(
  check: () => Promise<boolean> | boolean,
  what: string,
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/** All reads and the resolution itself run as a GUEST — the floor of the role ladder. */
const GUEST_COOKIE = sessionCookieHeader('guest');

async function reviewQueueHtml(): Promise<string> {
  const res = await fetch(`${BASE_URL}/reviews`, {
    signal: AbortSignal.timeout(3000),
    headers: { Cookie: GUEST_COOKIE },
  });
  if (!res.ok) throw new Error(`GET /reviews returned ${res.status}`);
  return res.text();
}

/**
 * The phase's PREMISE assertion (2.1): the seeded fixture must land in the review band. When
 * this times out, the calibration drifted (typically a beets version bump moved the scoring) —
 * the failure names the premise instead of letting the scenario silently degrade.
 */
async function pollForQueuedReview(timeoutMs = 60_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let html = '';
  for (;;) {
    html = await reviewQueueHtml();
    const importId = /href="\/reviews\/([^"]+)"/.exec(html)?.[1];
    if (importId !== undefined) {
      // The queued item must be a genuine match-review — not a no-match fallback.
      expect(html).toContain('data-kind="match-review"');
      return importId;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        'PREMISE BROKEN: the review-band fixture did not queue a match review — ' +
          'track-review-band.flac no longer scores between AUTO_APPLY_THRESHOLD and no-match ' +
          'under the image’s pinned beets. Recalibrate per test/e2e/fixtures/README.md.',
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/** Resolve over the SAME HTTP surface a browser submits — the form action, form-encoded. The
 *  `confirmed` field is the destructive verb's two-step marker; posting it directly is the
 *  documented client shape, not a back door. */
async function rejectUnusableDelivery(importId: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/reviews/${importId}?/resolve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: BASE_URL,
      Cookie: GUEST_COOKIE,
    },
    body: new URLSearchParams({
      verb: 'reject-unusable-delivery',
      confirmed: 'true',
      reasons: 'wrong edition — rejected by the e2e revival phase',
    }),
    redirect: 'manual',
  });
  // Success is the action's 303 back to /reviews (or SvelteKit's JSON encoding of it). A 200
  // can also carry an encoded action FAILURE — accepting it blind would mask the failure until
  // an unrelated probe times out, naming the wrong suspect.
  if (res.status === 303) return;
  if (res.status !== 200) {
    throw new Error(`resolve action returned ${res.status}: ${await res.text()}`);
  }
  const text = await res.text();
  let body: { type?: string };
  try {
    body = JSON.parse(text) as { type?: string };
  } catch {
    throw new Error(`resolve action returned a non-JSON 200: ${text.slice(0, 200)}`);
  }
  if (body.type !== 'redirect') {
    throw new Error(`resolve action did not redirect: ${JSON.stringify(body)}`);
  }
}

/**
 * Round two of the hunt, scripted from on-disk mappings (priority 1 outranks the on-disk
 * default-priority stubs). The files live OUTSIDE `mappings/` so WireMock never auto-loads
 * them into other phases; this phase registers them ad hoc — and because they are files, the
 * downloader's contract tier validates their payloads against the adapter schemas exactly
 * like the permanent stubs (`test/contract/support/registry.ts` `scriptedStubSchemas`), so
 * they cannot drift silently.
 */
const SCRIPTED_DIR = fileURLToPath(new URL('stubs/slskd/scripted/', import.meta.url));
const ON_DISK_MAPPINGS_DIR = fileURLToPath(new URL('stubs/slskd/mappings/', import.meta.url));

function readMapping(dir: string, name: string): { response: { jsonBody?: unknown } } {
  return JSON.parse(readFileSync(path.join(dir, name), 'utf8')) as {
    response: { jsonBody?: unknown };
  };
}

describe('review-resolution revival loop (reject-unusable-delivery over HTTP, cross-context)', () => {
  beforeAll(async () => {
    // Round one downloads the REVIEW-BAND fixture at the on-disk stub's reported location; the
    // revival downloads the CLEAN fixture at transfer-2's reported location. Both seeded up
    // front at stub-REPORTED paths — the tier's provenance doctrine.
    seedFixture('track-review-band.flac', STAGED_SUBDIR);
    seedFixture('track.flac', ALT_SUBDIR);
    // Round one must answer exactly as every other phase sees it: the scripted round-one
    // search-create is a replica of the on-disk stub (it exists only to arm the scenario
    // transition), and this pins the replica against the original so it cannot shadow-drift.
    expect(readMapping(SCRIPTED_DIR, 'search-create-round1.json').response.jsonBody).toEqual(
      readMapping(ON_DISK_MAPPINGS_DIR, 'search-create.json').response.jsonBody,
    );
    const scriptedMappings = readdirSync(SCRIPTED_DIR).toSorted((a, b) => a.localeCompare(b));
    for (const name of scriptedMappings) {
      await admin('POST', '/mappings', readMapping(SCRIPTED_DIR, name));
    }
    await waitForOk(BASE_URL);
  });

  afterAll(async () => {
    // Drop every ad-hoc registration and reload the on-disk stubs — a future phase inherits
    // exactly the files (the nonblocking phase's established teardown).
    await admin('POST', '/mappings/reset');
  });

  // Two full delivery+beets cycles with a held search in between: the phase's own probe
  // budgets (60 s + 180 s legs) overrun the tier's 90 s default, so it carries its own ceiling.
  it(
    'queues a genuine low-confidence review, rejects it as unusable over HTTP, and witnesses the revived hunt complete into the library',
    { timeout: 300_000 },
    async () => {
      const acquisitionId = await submitAcquisition(MBID);

      // ── 2.1 Setup: first delivery imports into a QUEUED review — the premise assertion.
      const importId = await pollForQueuedReview();
      await pollForStatus(acquisitionId, new Set(['Waiting for your review']));
      expect(countEvents(IMPORTER_DB, 'ImportApplied')).toBe(0); // in-band, not auto-applied
      expect(existsSync(DEPOSIT_RELEASE_DIR)).toBe(true); // the delivery the review is about

      // ── 2.2 Resolution over HTTP with a production-codec GUEST session.
      await rejectUnusableDelivery(importId);
      await pollUntil(async () => {
        const html = await reviewQueueHtml();
        return html.includes('data-testid="empty"');
      }, 'the review queue to empty after resolution');
      await pollForEvent(IMPORTER_DB, 'ReleaseVerdictRecorded');

      // ── D4: the rejection's contract, witnessed from outside — the delivered files are gone.
      // The revival's search still holds incomplete, so nothing can have re-deposited: race-free.
      await pollUntil(
        () => !existsSync(DEPOSIT_RELEASE_DIR),
        'the rejected delivery’s deposited files to be deleted',
      );

      // ── 2.3 Revival: the hunt resumes WITHOUT a new submission and parks on the held
      // second search round — the verdict provably crossed the seam into the downloader.
      // (These counts pin internal event names from both stores: the only witnesses that
      // revival != resubmission. Renaming either context's events breaks this phase — which
      // gates only on main — so budget for it in any event-rename sweep.)
      await pollForStatus(acquisitionId, new Set(['Searching']), 60_000);
      expect(countEvents(DOWNLOADER_DB, 'AcquisitionRequested')).toBe(1);
      expect(countEvents(DOWNLOADER_DB, 'FulfillmentRejected')).toBe(1);

      // Release the held search: the second candidate delivers, real beets scores the clean
      // fixture at distance 0 and auto-applies, and the story reaches its ordinary ending told
      // in the ordinary narration — no special-case copy for a revived hunt.
      await admin('PUT', '/scenarios/search2/state', { state: 'Complete' });
      await pollForStatus(acquisitionId, new Set(['In your library']), 180_000);

      // The whole loop recorded exactly one acquisition, two import cycles on one stream, one
      // human verdict, one applied import — and one enqueue per candidate (journal-asserted).
      await pollForEvent(IMPORTER_DB, 'ImportApplied', 30_000);
      expect(countEvents(IMPORTER_DB, 'ImportRequested')).toBe(2);
      expect(countEvents(IMPORTER_DB, 'ImportApplied')).toBe(1);
      expect(countEvents(IMPORTER_DB, 'ReviewResolved')).toBe(1);
      expect(countEvents(IMPORTER_DB, 'ReleaseVerdictRecorded')).toBe(1);
      expect(await enqueueCount('peer1')).toBe(1);
      expect(await enqueueCount('peer2')).toBe(1);
      const settledQueueHtml = await reviewQueueHtml();
      expect(settledQueueHtml.includes('data-testid="empty"')).toBe(true);
      expect(existsSync(LIBRARY_DIR)).toBe(true);
      expect(existsSync(DEPOSIT_RELEASE_DIR)).toBe(true); // the re-deposited second delivery

      // Source-resource stewardship holds for the revived round too: the second search and the
      // second transfer record are cleaned up like the first.
      await pollUntil(
        async () => {
          const deletes = await slskdDeletes();
          return (
            deletes.includes('/api/v0/searches/search-2') &&
            deletes.some((url) => url.startsWith('/api/v0/transfers/downloads/peer2/transfer-2'))
          );
        },
        'stewardship DELETEs for the revived round’s search and transfer',
        15_000,
      );
    },
  );
});

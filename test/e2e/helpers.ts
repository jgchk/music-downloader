import Database from 'better-sqlite3';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// The PRODUCTION session codec, imported — not reimplemented — so the harness's minted cookies
// can never drift from what the image's unmodified gate verifies (out-of-process-e2e).
import { SESSION_COOKIE, signSession } from '../../packages/web/src/lib/server/session.js';
// The PRODUCTION copy layer, for the same reason: this tier scrapes the detail page's status
// phrases, so the whitelists below are built from the strings the app renders — a copy change is
// a compile-visible harness change here, never a main-only e2e surprise (e2e-blackbox blast
// radius). Which phrases mean "terminal" or "delivered" stays this harness's own grouping.
import { IMPORT_VOICE_PHRASE, statusPhrase } from '../../packages/web/src/lib/copy.js';

/**
 * Shared driver utilities for the out-of-process E2E tier. The suite is a browserless HTTP client
 * over the SAME web routes the UI serves — form-encoded actions, HTML reads parsed via the
 * components' stable `data-testid` markers — plus host-side, read-only peeks into the two
 * bind-mounted SQLite event stores (the spec's "stores are durable, not in-memory" evidence).
 */

export const BASE_URL = process.env['E2E_BASE_URL'] ?? 'http://localhost:3000';
export const DATA_DIR = process.env['E2E_DATA_DIR'] ?? path.join(process.cwd(), '.e2e-tmp');

/** The harness secret run.sh handed the container — a throwaway that guards nothing real. */
export const SESSION_SECRET =
  process.env['E2E_SESSION_SECRET'] ?? 'e2e-session-secret-0123456789abcdef';

/**
 * Mint-a-cookie (web-access-control design D7): a valid session for the tier's HTTP driver. The
 * harness stands in for the server's owner, so it mints the `owner` role by default — the base
 * interface this tier drives is role-independent, but an owner-gated verb must be reachable from
 * here when one ships. A phase proving a verb needs NO privilege passes `'guest'` (auth-roles:
 * the only other role) and drives the same routes from the floor of the role ladder.
 */
export function sessionCookieHeader(role: 'owner' | 'guest' = 'owner'): string {
  const cookie = signSession(
    { plexAccountId: 'e2e', username: 'e2e-harness', role },
    SESSION_SECRET,
    Date.now(),
  );
  return `${SESSION_COOKIE}=${cookie}`;
}

export const STAGING_DIR = path.join(DATA_DIR, 'music', 'staging');
export const DEPOSIT_DIR = path.join(DATA_DIR, 'music', 'deposit');
export const LIBRARY_DIR = path.join(DATA_DIR, 'music', 'library');
export const DOWNLOADER_DB = path.join(DATA_DIR, 'data', 'downloader', 'events.db');
export const IMPORTER_DB = path.join(DATA_DIR, 'data', 'importer', 'events.db');

/** The one release the stubs know; keep in agreement with test/e2e/stubs mappings. */
export const MBID = '6e29d5f7-4b0f-4b62-8862-1c62ae2a1eb1';
export const STAGED_SUBDIR = 'Test Album';
export const STAGED_FILE = '01 Track One.flac';

const FIXTURES_DIR = fileURLToPath(new URL('fixtures/', import.meta.url));

/**
 * Seed a "downloaded" file at the location the slskd stub REPORTS for it (a `localFilename`
 * under the options.json downloads root, re-rooted by the app onto STAGING_ROOT) — never at a
 * path this harness recomputes from the app's own logic. `fixture` names a file under
 * test/e2e/fixtures (calibration provenance in fixtures/README.md).
 */
export function seedFixture(fixture: string, subdir: string, file = STAGED_FILE): void {
  const dir = path.join(STAGING_DIR, subdir);
  mkdirSync(dir, { recursive: true });
  copyFileSync(path.join(FIXTURES_DIR, fixture), path.join(dir, file));
}

/** The default seeding: the clean fixture at the on-disk stub's reported location. */
export function seedStagedFixture(): void {
  seedFixture('track.flac', STAGED_SUBDIR);
}

export async function waitForOk(url: string, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastFailure = 'no response yet';
  for (;;) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return;
      lastFailure = `HTTP ${String(res.status)}`;
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error); // not up yet
    }
    if (Date.now() >= deadline) {
      throw new Error(`timed out waiting for ${url} (last failure: ${lastFailure})`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/**
 * Submit an acquisition through the real submit form action (progressive-enhancement POST).
 * SvelteKit's CSRF check requires a same-origin Origin header; success is the action's 303
 * redirect to the new acquisition's page, from which the id is read.
 */
export async function submitAcquisition(mbid: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/acquisitions/new`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: BASE_URL,
      Cookie: sessionCookieHeader(),
    },
    body: new URLSearchParams({ kind: 'musicbrainz', mbid, targetType: 'album' }),
    redirect: 'manual',
  });
  // The action's success is a redirect to the new acquisition — either a raw 303 (Location
  // header) or SvelteKit's JSON ActionResult encoding of the same redirect.
  let location = '';
  if (res.status === 303) {
    location = res.headers.get('location') ?? '';
  } else if (res.status === 200) {
    const body = (await res.json()) as { type?: string; location?: string };
    if (body.type === 'redirect' && body.location) location = body.location;
  }
  const id = location.split('/').pop();
  if (!id) throw new Error(`submit returned ${res.status} with no redirect location`);
  return id;
}

/** Read an acquisition's status text from its detail page's `data-testid="status"` marker. */
export async function readStatus(id: string): Promise<string | undefined> {
  const res = await fetch(`${BASE_URL}/acquisitions/${id}`, {
    signal: AbortSignal.timeout(3000),
    headers: { Cookie: sessionCookieHeader() },
  });
  if (!res.ok) return undefined;
  const html = await res.text();
  return /data-testid="status"[^>]*>([^<]+)</.exec(html)?.[1]?.trim();
}

// The detail page's status marker speaks the human status phrases (legible-acquisition-history),
// and a delivery only reads as settled once its import applied — so "terminal" here means the
// story's true endings, not the downloader enum: the loop now proves the WHOLE pipeline through
// beets before it returns. The phrases come from the production copy layer; only the grouping
// (which of them end a story) is this tier's own claim.
const TERMINAL = new Set([
  IMPORT_VOICE_PHRASE.applied,
  statusPhrase('Exhausted'),
  statusPhrase('Conflicted'),
  statusPhrase('Cancelled'),
  statusPhrase('MetadataFailed'),
  IMPORT_VOICE_PHRASE.rejected,
]);

export async function pollUntilTerminal(id: string, timeoutMs = 90_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const status = await readStatus(id);
    if (status !== undefined && TERMINAL.has(status)) return status;
    if (Date.now() >= deadline) {
      throw new Error(`acquisition ${id} did not settle in time (last status: ${status})`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/**
 * Poll until the detail page's status marker reads one of the given phrases. For observing a
 * mid-story state the terminal poll deliberately never settles on (e.g. delivered-and-importing
 * while a test has the bridge gated shut).
 */
export async function pollForStatus(
  id: string,
  phrases: ReadonlySet<string>,
  timeoutMs = 90_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const status = await readStatus(id);
    if (status !== undefined && phrases.has(status)) return status;
    if (Date.now() >= deadline) {
      throw new Error(
        `acquisition ${id} never showed ${[...phrases].join(' / ')} (last: ${status})`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/** The delivered-and-importing narration: the downloader has deposited; the import is working. */
export const DELIVERED_NARRATION: ReadonlySet<string> = new Set([
  IMPORT_VOICE_PHRASE.confirming,
  IMPORT_VOICE_PHRASE.matching,
  IMPORT_VOICE_PHRASE.applying,
  IMPORT_VOICE_PHRASE.awaitingReview,
]);

/** True when the review queue page shows its explicit empty marker. */
export async function reviewQueueEmpty(): Promise<boolean> {
  const res = await fetch(`${BASE_URL}/reviews`, {
    signal: AbortSignal.timeout(3000),
    headers: { Cookie: sessionCookieHeader() },
  });
  if (!res.ok) throw new Error(`GET /reviews returned ${res.status}`);
  const body = await res.text();
  return body.includes('data-testid="empty"');
}

/**
 * Read-only peek into a module's on-disk event store. Opened per call (never cached) so WAL
 * checkpoints from the container are always visible; `fileMustGrow` guards prove durability.
 */
export function eventTypes(dbFile: string): string[] {
  const db = new Database(dbFile, { readonly: true, fileMustExist: true });
  try {
    return db
      .prepare('SELECT type FROM events ORDER BY global_seq ASC')
      .all()
      .map((row) => (row as { type: string }).type);
  } finally {
    db.close();
  }
}

export function countEvents(dbFile: string, type: string): number {
  const db = new Database(dbFile, { readonly: true, fileMustExist: true });
  try {
    const row = db.prepare('SELECT COUNT(*) AS n FROM events WHERE type = ?').get(type) as {
      n: number;
    };
    return row.n;
  } finally {
    db.close();
  }
}

export async function pollForEvent(
  dbFile: string,
  type: string,
  timeoutMs = 60_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (existsSync(dbFile) && countEvents(dbFile, type) > 0) return;
    if (Date.now() >= deadline) {
      const seen = existsSync(dbFile) ? eventTypes(dbFile).join(', ') : '(no db file)';
      throw new Error(`no ${type} in ${dbFile} in time; saw: ${seen}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

export { IMPORT_VOICE_PHRASE, statusPhrase } from '../../packages/web/src/lib/copy.js';

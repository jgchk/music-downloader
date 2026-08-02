import Database from 'better-sqlite3';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
// The PRODUCTION session codec, imported — not reimplemented — so the harness's minted cookies
// can never drift from what the image's unmodified gate verifies (out-of-process-e2e).
import { SESSION_COOKIE, signSession } from '../../packages/web/src/lib/server/session.js';

/**
 * Shared driver utilities for the out-of-process E2E tier. The suite is a browserless HTTP client
 * over the SAME web routes the UI serves — form-encoded actions, HTML reads parsed via the
 * components' stable `data-testid` markers — plus host-side, read-only peeks into the two
 * bind-mounted SQLite event stores (the spec's "stores are durable, not in-memory" evidence).
 */

export const BASE_URL = process.env['E2E_BASE_URL'] ?? 'http://localhost:3000';
export const DATA_DIR = process.env['E2E_DATA_DIR'] ?? join(process.cwd(), '.e2e-tmp');

/** The harness secret run.sh handed the container — a throwaway that guards nothing real. */
export const SESSION_SECRET =
  process.env['E2E_SESSION_SECRET'] ?? 'e2e-session-secret-0123456789abcdef';

/** Mint-a-cookie (web-access-control design D7): a valid session for the tier's HTTP driver. */
export function sessionCookieHeader(): string {
  const cookie = signSession(
    { plexAccountId: 'e2e', username: 'e2e-harness' },
    SESSION_SECRET,
    Date.now(),
  );
  return `${SESSION_COOKIE}=${cookie}`;
}

export const STAGING_DIR = join(DATA_DIR, 'music', 'staging');
export const DEPOSIT_DIR = join(DATA_DIR, 'music', 'deposit');
export const LIBRARY_DIR = join(DATA_DIR, 'music', 'library');
export const DOWNLOADER_DB = join(DATA_DIR, 'data', 'downloader', 'events.db');
export const IMPORTER_DB = join(DATA_DIR, 'data', 'importer', 'events.db');

/** The one release the stubs know; keep in agreement with test/e2e/stubs mappings. */
export const MBID = '6e29d5f7-4b0f-4b62-8862-1c62ae2a1eb1';
export const STAGED_SUBDIR = 'Test Album';
export const STAGED_FILE = '01 Track One.flac';

const FIXTURE = fileURLToPath(new URL('./fixtures/track.flac', import.meta.url));

/**
 * Seed the "downloaded" file at the location the slskd stub REPORTS for it (events.json
 * `localFilename` under the options.json downloads root, re-rooted by the app onto
 * STAGING_ROOT) — never at a path this harness recomputes from the app's own logic.
 */
export function seedStagedFixture(): void {
  const dir = join(STAGING_DIR, STAGED_SUBDIR);
  mkdirSync(dir, { recursive: true });
  copyFileSync(FIXTURE, join(dir, STAGED_FILE));
}

export async function waitForOk(url: string, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return;
    } catch {
      // not up yet
    }
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${url}`);
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
// beets before it returns.
const TERMINAL = new Set([
  'In your library',
  'No usable download found',
  'Stopped \u{2014} destination occupied',
  'Cancelled',
  'Couldn\u{2019}t identify the release',
  'Import rejected',
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

/** True when the review queue page shows its explicit empty marker. */
export async function reviewQueueEmpty(): Promise<boolean> {
  const res = await fetch(`${BASE_URL}/reviews`, {
    signal: AbortSignal.timeout(3000),
    headers: { Cookie: sessionCookieHeader() },
  });
  if (!res.ok) throw new Error(`GET /reviews returned ${res.status}`);
  return (await res.text()).includes('data-testid="empty"');
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

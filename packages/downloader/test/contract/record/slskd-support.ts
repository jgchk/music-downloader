import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTRACT_FIXTURE_ROOT, type ContractFixture } from '../support/fixture.js';

/**
 * The recording discipline both slskd recorders share — the live-network one (`slskd.ts`) and the
 * lab one (`slskd-lab.ts`). It exists so the *scrub* cannot drift between them: a fixture recorded
 * by either route passes through the same anonymization and the same consumed-field projections
 * before it is written to a public repository.
 *
 * The lab's peers are invented (`labpeer`/`labsut`) and its corpus is synthesized, so nothing here
 * is load-bearing for lab captures — which is exactly why it is applied to them anyway. The scrub
 * must stay exercised on the path that does not need it, or it will have rotted by the time a live
 * re-record needs it (a past recorder leaked Soulseek credentials and peer PII precisely because
 * the projections were a special case rather than the default).
 */

/** slskd's own version — the only version a fixture recorded here can speak for. */
export const PINNED_SLSKD_VERSION = '0.22.5.0';

export interface Capture {
  readonly status: number;
  readonly body: unknown;
}

/**
 * A username anonymizer with a stable, first-seen-order mapping. Real Soulseek usernames are third
 * parties' identities; `peerN` keeps the shape (and cross-fixture consistency) without the person.
 *
 * `seed` pins chosen usernames to chosen aliases up front. The lab recorder needs it: with
 * first-seen ordering alone, re-recording one scenario in isolation would rename its peer (the
 * second lab identity becoming `peer1` because the first never appeared), so fixture paths would
 * depend on which scenarios happened to run — the opposite of the per-scenario re-recordability
 * this lab exists to provide.
 */
export function createAnonymizer(seed: readonly string[] = []): {
  alias: (username: string) => string;
  sanitize: (value: unknown) => unknown;
  aliases: () => Record<string, string>;
} {
  const usernames = new Map<string, string>();
  for (const [index, username] of seed.entries()) usernames.set(username, `peer${index + 1}`);

  const alias = (username: string): string => {
    const existing = usernames.get(username);
    if (existing !== undefined) return existing;
    const next = `peer${usernames.size + 1}`;
    usernames.set(username, next);
    return next;
  };

  /**
   * Free text slskd writes about a peer — every failure `exception` and enqueue-rejection body
   * names the user, and some name their network address ("Failed to establish a … connection to
   * bob (203.0.113.7:50300)"). Those strings are the whole point of the failure fixtures, so they
   * are kept — but a username in prose is the same person as a username in a field, and an address
   * is worse. Both are rewritten here so a live re-record cannot publish what a `username`-keyed
   * pass alone would walk straight past.
   */
  const scrubText = (text: string): string => {
    let scrubbed = text;
    // Longest name first: with `bob` before `bobby`, scrubbing `bobby` would leave `peer1by` — a
    // corrupted capture that still looks plausible. Sorting makes the longest match win.
    const byLength = [...usernames].sort(([a], [b]) => b.length - a.length);
    for (const [username, replacement] of byLength) {
      scrubbed = scrubbed.replaceAll(username, replacement);
    }
    // IPv4 host:port as slskd formats peer endpoints.
    return scrubbed.replace(/\b\d{1,3}(?:\.\d{1,3}){3}:\d+\b/g, '<peer-address>');
  };

  /**
   * Register every username in a payload before anything is rewritten. A single left-to-right walk
   * is not enough: in a real search response `username` is the LAST key of each peer object, so its
   * own `files[].filename` entries — which routinely contain the sharer's name — would be scrubbed
   * against an alias map that does not yet know it. Collect first, rewrite second.
   */
  const collect = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) collect(item);
      return;
    }
    if (value !== null && typeof value === 'object') {
      for (const [key, val] of Object.entries(value)) {
        if (key === 'username' && typeof val === 'string') alias(val);
        else collect(val);
      }
    }
  };

  const rewrite = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(rewrite);
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, val]) =>
          key === 'username' && typeof val === 'string' ? [key, alias(val)] : [key, rewrite(val)],
        ),
      );
    }
    if (typeof value === 'string') {
      // Per-peer share-alias prefixes (`@@xxxx\`) identify the sharing peer; the music path does not.
      return scrubText(value.replace(/^@@[^\\]+\\/, '@@share\\'));
    }
    return value;
  };

  const sanitize = (value: unknown): unknown => {
    collect(value);
    return rewrite(value);
  };

  return { alias, sanitize, aliases: () => Object.fromEntries(usernames) };
}

/**
 * Keep only the one consumed subtree — `directories` — so the Soulseek account credentials, listen
 * ports, blacklist, integrations, and the rest of slskd's effective config never reach a committed
 * fixture. Only `directories.downloads` is actually read by the adapter.
 */
export function projectOptions(body: unknown): unknown {
  const dirs = (body as { directories?: { incomplete?: string; downloads?: string } }).directories;
  return { directories: { incomplete: dirs?.incomplete, downloads: dirs?.downloads } };
}

/**
 * Keep only `DownloadFileComplete` events, each trimmed to the fields the staged-path resolver
 * consumes — `localFilename` + `transfer.id` — dropping the peer `username`, the `remoteFilename`
 * share token, and the rest of the transfer object. An event's `data` is a JSON-encoded string, so
 * the recursive anonymizer cannot reach inside it; this projection is what keeps third-party PII
 * out of the committed fixture. The event id is normalized to a non-identifying `evt-<prefix>`.
 */
export function projectEvents(body: unknown, keep: number, mustInclude?: string): unknown {
  const events = Array.isArray(body) ? body : [];
  const kept: unknown[] = [];
  const seen: string[] = [];
  for (const raw of events) {
    const event = raw as { timestamp?: string; type?: string; data?: string };
    if (event.type !== 'DownloadFileComplete' || typeof event.data !== 'string') continue;
    const data = JSON.parse(event.data) as { localFilename?: string; transfer?: { id?: string } };
    const id = data.transfer?.id;
    if (data.localFilename === undefined || id === undefined) continue;
    seen.push(id);
    kept.push({
      timestamp: event.timestamp,
      type: event.type,
      id: `evt-${id.slice(0, 8)}`,
      data: JSON.stringify({ localFilename: data.localFilename, transfer: { id } }),
    });
    if (kept.length >= keep) break;
  }
  // The whole point of recording events beside a poll is that they name the SAME transfer — the
  // staged-path resolver matches them by id. Taking the newest few and hoping is how a fixture ends
  // up claiming a coupling it never witnessed, so the caller names the id it expects.
  if (mustInclude !== undefined && !seen.includes(mustInclude)) {
    throw new Error(
      `events capture does not contain this run's transfer ${mustInclude} (saw: ${seen.join(', ') || 'none'}) — the log may lag the poll; re-run the scenario`,
    );
  }
  return kept;
}

/** An authenticated caller for one slskd instance that never throws on status. */
export function createCaller(
  baseUrl: string,
  apiKey: string,
): (method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown) => Promise<Capture> {
  return async (method, path, body) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    // slskd answers an enqueue rejection with a bare exception *message* — capture it verbatim
    // rather than forcing it through JSON.parse, because that string is itself consumed contract.
    const parsed = ((): unknown => {
      if (text === '') return undefined;
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    })();
    return { status: response.status, body: parsed };
  };
}

/**
 * Confirm the instance being recorded really is the version the fixtures will claim. Without this
 * the version lives in four places that nothing cross-checks, and following the documented bump
 * procedure produces a full set of fresh fixtures all stamped with the old version — green, and a
 * lie about the one thing a fixture's meaning depends on.
 */
export async function assertPinnedVersion(
  call: (method: 'GET' | 'POST' | 'DELETE', path: string) => Promise<Capture>,
): Promise<void> {
  const application = await call('GET', '/api/v0/application');
  // slskd reports its version as an object: { full, current, latest, … }. `current` is the build
  // string that appears in fixture provenance.
  const version = (application.body as { version?: { current?: string } } | undefined)?.version
    ?.current;
  if (version === undefined) {
    throw new Error('could not read the slskd version from GET /api/v0/application');
  }
  if (!version.startsWith(PINNED_SLSKD_VERSION)) {
    throw new Error(
      `recording against slskd ${version}, but fixtures are stamped ${PINNED_SLSKD_VERSION}. ` +
        'Re-record deliberately: see "Bumping the pinned slskd version" in test/contract/README.md.',
    );
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Write a fixture under `fixtures/slskd/<scenario>/`, creating the scenario directory. */
export function createWriter(scenarioDir: string): (name: string, f: ContractFixture) => void {
  const dir = join(CONTRACT_FIXTURE_ROOT, 'slskd', scenarioDir);
  mkdirSync(dir, { recursive: true });
  return (name, fixture) => {
    writeFileSync(join(dir, name), `${JSON.stringify(fixture, null, 2)}\n`);
    console.log(`wrote slskd/${scenarioDir}/${name} (${fixture.response.status})`);
  };
}

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as authz from './authz.js';

/**
 * The seam's boundary (web-authorization): `authorize` is the ONLY reader of a session's role.
 * Call sites name actions, never roles — a route that reads `session.role` or compares against
 * `'owner'` has smuggled the decision out of the decision point, which is exactly what makes an
 * authorization model unswappable. This is the house's grep-backed convention test (same shape as
 * the skins/app.html drift guard): the compiler cannot express "nobody else may read this field",
 * so the repository does.
 */

const SOURCE_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/**
 * The ways a module can read a role, as source patterns. Property access covers `session.role`
 * and `claims.role` (an aria `role="…"` attribute is not a property access, so components are not
 * false-flagged); the destructuring and index forms are the idiomatic escapes a `.role`-only guard
 * would walk straight past; the literals catch a hand-rolled comparison against a role name.
 */
const ROLE_READS: readonly RegExp[] = [
  /\.role\b/,
  /[{,]\s*role\s*[,}=:]/,
  /\[\s*['"]role['"]\s*\]/,
  /['"](owner|guest)['"]/,
];

/** Where reading a role is the module's JOB — the derivation point, the codec, and the seam. */
const ROLE_READERS = [
  'lib/server/authz.ts',
  'lib/server/session.ts',
  'lib/server/plex/adapter.ts',
  // The login callback threads the derived role into the mint; it never branches on it.
  'routes/login/callback/+server.ts',
  // The unit fake mirrors the port's granted shape.
  'lib/server/plex/__fixtures__/fake.ts',
].map((relative_) => path.join(SOURCE_ROOT, relative_));

const EXEMPT = new Set(ROLE_READERS);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(entryPath);
    if (!/\.(ts|svelte)$/.test(entry.name) || entry.name.includes('.test.')) return [];
    return EXEMPT.has(entryPath) ? [] : [entryPath];
  });
}

const relative = (file: string): string => path.relative(SOURCE_ROOT, file);

describe('the authorization seam is the only role reader', () => {
  it('exposes a decision, not its inputs: no role table or role list escapes the module', () => {
    // Exporting the table would let a call site re-derive the decision and drift from it.
    expect(Object.keys(authz)).toEqual(['authorize']);
  });

  it.each(sourceFiles(SOURCE_ROOT).map((file) => relative(file)))(
    '%s decides no privilege of its own',
    (file) => {
      const source = readFileSync(path.join(SOURCE_ROOT, file), 'utf8');
      for (const pattern of ROLE_READS) expect(source).not.toMatch(pattern);
    },
  );

  it.each(ROLE_READERS.map((file) => relative(file)))(
    'exempts %s only while it still reads a role (no stale free passes)',
    (file) => {
      const full = path.join(SOURCE_ROOT, file);
      expect(existsSync(full), `${file} is exempted but no longer exists`).toBe(true);
      const source = readFileSync(full, 'utf8');
      expect(
        ROLE_READS.some((pattern) => pattern.test(source)),
        `${file} no longer reads a role — drop it from the exemption list`,
      ).toBe(true);
    },
  );

  it('has no production consumer yet — arming the seam is gated on trustworthy ownership', () => {
    // A TRIPWIRE, not a preference. `owner` is derived from plex.tv's `owned` flag on a resource
    // that self-asserts its own identity and server capability, so a forged registration under an
    // attacker's own account decodes as OWNER (docs/research/plex-machine-identifier-trust.md).
    // That is harmless only while nothing asks the permission question. Whoever adds the first
    // consumer must land the account-identity pin (PLEX_OWNER_ACCOUNT_ID / plex.tv's `ownerId`)
    // in the same change — deleting this test without doing so re-opens a privilege escalation.
    const consumers = sourceFiles(SOURCE_ROOT).filter((file) =>
      /\bauthorize\b/.test(readFileSync(file, 'utf8')),
    );
    expect(consumers.map((file) => relative(file))).toEqual([]);
  });
});

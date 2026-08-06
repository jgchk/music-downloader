import { readFileSync, readdirSync } from 'node:fs';
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

/** Where reading a role is the module's JOB — the derivation point, the codec, and the seam. */
const ROLE_READERS = new Set(
  [
    'lib/server/authz.ts',
    'lib/server/session.ts',
    'lib/server/plex/adapter.ts',
    'lib/server/plex/port.ts',
    'lib/server/plex/schemas.ts',
    // The login callback threads the derived role into the mint; it never branches on it.
    'routes/login/callback/+server.ts',
    // The unit fake mirrors the port's granted shape.
    'lib/server/plex/__fixtures__/fake.ts',
  ].map((relative) => path.join(SOURCE_ROOT, relative)),
);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(entryPath);
    if (!/\.(ts|svelte)$/.test(entry.name) || entry.name.includes('.test.')) return [];
    return ROLE_READERS.has(entryPath) ? [] : [entryPath];
  });
}

describe('the authorization seam is the only role reader', () => {
  it('exposes a decision, not its inputs: no role table or role list escapes the module', () => {
    // Exporting the table would let a call site re-derive the decision and drift from it.
    expect(Object.keys(authz)).toEqual(['authorize']);
  });

  it.each(sourceFiles(SOURCE_ROOT))('%s decides no privilege of its own', (file) => {
    const source = readFileSync(file, 'utf8');
    // `.role` catches `session.role` / `claims.role` reads (an aria `role="…"` attribute is not a
    // property access, so components are not false-flagged); the literals catch a hand-rolled
    // comparison against a role name.
    expect(source).not.toMatch(/\.role\b/);
    expect(source).not.toMatch(/['"](owner|guest)['"]/);
  });
});

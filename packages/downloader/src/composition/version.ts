import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The product's release version, read from the workspace root package.json at runtime. The root is
 * the single version source (the pre-merge `version:prep` step bumps it; bounded-context packages
 * are unversioned, and the build never inlines a version). Both `src/composition/version.ts` and
 * `dist/composition/version.js` sit four levels below the workspace root, in development and in
 * the runtime image (which preserves the workspace layout), so one relative resolution holds
 * everywhere.
 *
 * The composition root reads this once and injects it into the interfaces, keeping file I/O out
 * of those inbound adapters.
 */
export function readAppVersion(): string {
  const path = fileURLToPath(new URL('../../../../package.json', import.meta.url));
  return (JSON.parse(readFileSync(path, 'utf8')) as { version: string }).version;
}

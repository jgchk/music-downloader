import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The product's release version, read from the workspace root package.json at startup — the single
 * version source (bounded-context packages are unversioned). Resolves relative to this module so
 * it works from both `src` (tests) and `dist` (runtime image, which preserves the workspace
 * layout): each sits four levels below the workspace root.
 */
export function readAppVersion(): string {
  const path = fileURLToPath(new URL('../../../../package.json', import.meta.url));
  return (JSON.parse(readFileSync(path, 'utf8')) as { version: string }).version;
}

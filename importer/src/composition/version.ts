import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The app version, read from package.json at startup — the single version source for the OpenAPI
 * document and the MCP server info. Resolves relative to this module so it works from both `src`
 * (tests) and `dist` (runtime image, where package.json sits two levels up at the app root).
 */
export function readAppVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(readFileSync(join(here, '..', '..', 'package.json'), 'utf8')) as {
    version: string;
  };
  return pkg.version;
}

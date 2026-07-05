import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The application's release version, read from package.json at runtime. package.json is the single
 * source of truth (the pre-merge `version:prep` step bumps it; the build never inlines a version).
 * It ships next to the compiled `dist/` in the container and sits at the repo root in development,
 * so the same `../../package.json` relative resolution holds in both — `src/composition/version.ts`
 * and `dist/composition/version.js` are each two levels below their root.
 *
 * The composition root reads this once and injects it into the interfaces (OpenAPI `info.version`,
 * MCP server metadata), keeping file I/O out of those inbound adapters.
 */
export function readAppVersion(): string {
  const path = fileURLToPath(new URL('../../package.json', import.meta.url));
  return (JSON.parse(readFileSync(path, 'utf8')) as { version: string }).version;
}

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The operation-correlation boundaries (change: end-to-end-correlation), grep-backed in the style
 * of the rest of this tier.
 *
 * Two invariants that no type can express and no reviewer can be relied on to re-check:
 *
 *  1. **The domain is blind to the pair.** Correlation and causation are shell infrastructure —
 *     they live in command context and event metadata only. The moment a decider, an `evolve`, or
 *     an event payload learns the word, the pair has become business data: it starts being folded
 *     into state, asserted on in domain tests, and — worst — persisted inside payloads where an
 *     upcaster would have to reason about it forever.
 *
 *  2. **No id reaches user-visible copy.** The pair is a diagnostic identity. Rendering one would
 *     put an opaque hex string in front of a user, and it would drag the e2e/Playwright scrape
 *     surface into every future change to correlation — a blast radius the design explicitly
 *     bought its way out of by keeping ids log-and-store-only.
 */

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** The words that mean the pair. Matched case-insensitively so `CorrelationId` is caught too. */
const PAIR_PATTERN = /correlation|causation/i;

function sourceFilesUnder(directory: string, extensions: readonly string[]): readonly string[] {
  const entries = readdirSync(path.join(REPO_ROOT, directory), {
    withFileTypes: true,
    recursive: true,
  });
  return entries
    .filter(
      (entry) => entry.isFile() && extensions.some((extension) => entry.name.endsWith(extension)),
    )
    .map((entry) => path.join(entry.parentPath, entry.name));
}

/** Lines that name the pair, with their file and 1-based line number, for a legible failure. */
function offendingLines(files: readonly string[]): readonly string[] {
  return files.flatMap((file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .map((line, index) => ({ line, number: index + 1 }))
      .filter(({ line }) => PAIR_PATTERN.test(line))
      .map(({ line, number }) => `${path.relative(REPO_ROOT, file)}:${number}: ${line.trim()}`),
  );
}

describe('the domain is blind to correlation and causation', () => {
  it.each([
    ['downloader', 'packages/downloader/src/domain'],
    ['importer', 'packages/importer/src/domain'],
  ])('no %s domain file names either half of the pair', (_module, directory) => {
    const files = sourceFilesUnder(directory, ['.ts']);
    expect(files.length).toBeGreaterThan(0); // the sweep must actually be looking at something

    expect(offendingLines(files)).toEqual([]);
  });
});

describe('no correlation id reaches user-visible copy', () => {
  it('the web copy layer never names the pair', () => {
    const files = sourceFilesUnder('packages/web/src/lib', ['.ts']).filter(
      (file) => !file.includes(`${path.sep}server${path.sep}`), // $lib/server is the shell, not copy
    );
    expect(files.length).toBeGreaterThan(0);

    expect(offendingLines(files)).toEqual([]);
  });

  it('no Svelte component renders the pair', () => {
    const files = sourceFilesUnder('packages/web/src', ['.svelte']);
    expect(files.length).toBeGreaterThan(0);

    expect(offendingLines(files)).toEqual([]);
  });
});

/**
 * The per-context correlation twins this file used to pin string-for-string are gone: the mechanism
 * moved to `@music/eventing` (extract-eventing-package D1/D5), so there is no deliberate duplication
 * left to protect from drift. What remains per context is a thin binding — the context name stamped
 * onto derived coordinates, and that module's own logger type — and each package's own suite covers
 * it. The shared-kernel avoidance this block guarded was retired with the rule it served: the line
 * is now no shared MODEL, and correlation is mechanism.
 */

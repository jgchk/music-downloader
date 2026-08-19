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
 * moved to `@music/eventing` (extract-eventing-package D1/D5), so the string-equality block has no
 * subject left. What remains per context is a thin binding plus inert re-export shims, and a
 * divergence in those is caught by the consuming package's own typecheck rather than by a grep.
 *
 * What did NOT move is the block below. The story format is still defined in TWO places that share
 * no code — the shared constant, and the web BFF's own mint — because a story belongs to neither
 * module (one request drives both), so the shell that spans them owns its mint. That is unchanged
 * by the extraction, and so is the drift mode: if the BFF minted a shape the modules reject, both
 * facades would discard every caller's story as malformed and mint their own, and NOTHING would log
 * it — `adoptOrMint` hands back the `malformed` origin, but neither facade reads it. The only
 * symptom would be that web log lines quietly stop joining module log lines.
 */
describe('the story format agrees everywhere it is defined', () => {
  it('the BFF mints a value the modules accept', async () => {
    // Behavioural, not textual: the BFF builds its id from bytes rather than declaring a pattern,
    // so the honest pin is that what it produces satisfies the shared predicate itself — not a
    // hand-copied regex, which would drift in lockstep with the mint it is supposed to check.
    const { mintCorrelationId } = await import('../../packages/web/src/lib/server/correlation.ts');
    const { isCorrelationId } = await import('../../packages/eventing/src/correlation.ts');

    expect(isCorrelationId(mintCorrelationId())).toBe(true);
  });
});

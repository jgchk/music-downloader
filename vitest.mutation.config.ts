import { defineConfig } from 'vitest/config';

/**
 * The suite the mutation runner executes (change: mutation-gate). Deliberately NOT the root
 * `vitest.config.ts`: that one composes projects, three of which belong to the web package —
 * including a Chromium browser-mode project — and the web package is outside mutation scope
 * (`stryker.config.mjs` says why). Pointing Stryker at the root config would stand up a browser
 * for every mutant run to execute tests that can kill none of them.
 *
 * One flat project rather than the two per-package ones, for the same reason the two exist
 * separately elsewhere and not here: a mutant in `downloader` is killed by whichever test notices
 * it, and nothing about that answer needs the tests partitioned by package.
 *
 * The **contract tiers are included** alongside the co-located unit suites, which is the one
 * non-obvious inclusion here. Design D3 puts adapters in mutation scope precisely because "a mutant
 * surviving the contract tier's fixture assertions is real signal about tolerant-reader strength" —
 * and that sentence is only true if the contract tier is among the tests allowed to kill. Running
 * the unit tier alone reports adapter mutants the frozen fixtures already pin as survivors —
 * measured at 22 across the seeding runs (829 survivors without the tier, 807 with it), for about
 * 70s of extra wall clock. Small, but every one of those 22 is a finding whose only honest fix is
 * "the assertion exists, in the tier you did not run", which is the false-positive shape the
 * admission contract exists to keep out.
 * (The two tiers' own configs anchor themselves per package via `root`; nothing in them needs that
 * when the include paths are written from the workspace root, and both tiers pass unchanged here.)
 *
 * The web contract tier stays out with the rest of the web package (`stryker.config.mjs` says why).
 *
 * No coverage block. Coverage is one merged 100% measurement owned by the root config and asserted
 * by the `test` lane; measuring it again here would be a second, weaker copy of that threshold —
 * and mutation testing is the instrument for the question coverage cannot answer anyway.
 */
export default defineConfig({
  test: {
    name: 'mutation',
    environment: 'node',
    include: [
      'packages/downloader/src/**/*.test.ts',
      'packages/importer/src/**/*.test.ts',
      'packages/downloader/test/contract/**/*.contract.test.ts',
      'packages/importer/test/contract/**/*.contract.test.ts',
    ],
    // The contract tiers serve frozen fixtures over a real local socket; their own configs allow
    // the same headroom.
    testTimeout: 20_000,
  },
});

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { slskdTransfersSchema } from '../../src/adapters/slskd/schemas.js';
import { flattenDownloads } from '../../src/adapters/slskd/transfers.js';
import { loadFixtures } from './support/fixture.js';

/**
 * Holds the project's *stubs* to the vocabulary the pinned slskd can actually speak.
 *
 * The failure that motivated this was invisible for a long time: unit tests asserted against
 * `Completed, Rejected` and `Completed, TimedOut` transfers, and passed, and meant nothing —
 * slskd 0.22.5 overwrites both with `Completed, Errored` before the API ever serves them. Coverage
 * was full, the classifier was green, and the states being tested could not occur. A stub is only
 * evidence if the provider can produce what it claims, so the reachable set is written down once,
 * with provenance, and every stub is checked against it.
 *
 * The other direction matters just as much: each terminal state must be witnessed by a fixture
 * recorded from a real slskd, so bumping the pinned version cannot quietly leave this file
 * describing the old one.
 */

const SPEC_DIR = new URL('./slskd-spec/', import.meta.url).pathname;
const ADAPTER_DIR = new URL('../../src/adapters/slskd/', import.meta.url).pathname;

// The E2E tier's slskd doubles are the other place a transfer state is written by hand — and they
// look more like a provider than anything else in the repo, so an impossible state hides best here.
const E2E_STUB_ROOT = new URL('../../../../test/e2e/stubs/slskd/', import.meta.url).pathname;
const E2E_ROOT = new URL('../../../../test/e2e/', import.meta.url).pathname;

/**
 * A `state:` literal is checked unless its own line carries this marker. Per-literal, not per-file:
 * the previous shape exempted `schemas.test.ts` wholesale on the grounds that its states were
 * search vocabulary — but that file *mixes* them, and line for line it is where the impossible
 * `InProgress, Transferring` actually sat. Exempting the file would have left the guard blind at
 * precisely the site whose regression motivates it. Marking the individual literal keeps every new
 * one checked by default and forces each exemption to say why.
 */
const EXEMPT_MARKER = 'vocabulary-exempt';

/** Every `*.test.ts` under the slskd adapter — no file is exempt, only individual literals. */
function transferStubFiles(): string[] {
  return readdirSync(ADAPTER_DIR)
    .filter((name) => name.endsWith('.test.ts'))
    .sort();
}

/** Every `state: '…'` literal in a source, minus the ones explicitly exempted on their own line. */
function statesIn(source: string): string[] {
  return source
    .split('\n')
    .filter((line) => !line.includes(EXEMPT_MARKER))
    .flatMap((line) => [...line.matchAll(/\bstate:\s*'([^']*)'/g)].map((m) => m[1]!));
}

/**
 * Transfer states stubbed inline in the E2E specs. Those files also carry `state:` literals that are
 * WireMock *scenario* names (`Hold`, `Completed`) rather than slskd vocabulary, so a literal counts
 * only when it sits in a transfer-shaped object — immediately followed by the `size` field every
 * such stub carries. Two of the three E2E sites that had to be hand-corrected were inline like this
 * and would otherwise stay unguarded.
 */
function e2eInlineStates(): string[] {
  return readdirSync(E2E_ROOT)
    .filter((name) => name.endsWith('.e2e.test.ts'))
    .flatMap((name) => {
      const source = readFileSync(join(E2E_ROOT, name), 'utf8');
      return [...source.matchAll(/\bstate:\s*'([^']*)',\s*\n\s*size:/g)].map((m) => m[1]!);
    });
}

/** Every `"state": "…"` literal in the E2E slskd WireMock doubles, recursively. */
function e2eStubStates(): string[] {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return walk(path);
      if (!entry.name.endsWith('.json')) return [];
      const source = readFileSync(path, 'utf8');
      // Only the transfer doubles: a search double's `state` is search vocabulary.
      if (!source.includes('directories')) return [];
      return [...source.matchAll(/"state":\s*"([^"]*)"/g)].map((m) => m[1]!);
    });
  return walk(E2E_STUB_ROOT);
}

const vocabulary = JSON.parse(readFileSync(`${SPEC_DIR}transfer-vocabulary.json`, 'utf8')) as {
  pinnedVersion: string;
  reachable: Record<string, string>;
  terminal: string[];
  unreachable: Record<string, string>;
};

const reachable = new Set(Object.keys(vocabulary.reachable));

/** Every transfer state carried by a recorded poll fixture. */
function recordedStates(): string[] {
  return loadFixtures('slskd')
    .filter((f) => f.name.endsWith('transfers-poll.json'))
    .flatMap(({ fixture }) => {
      const parsed = slskdTransfersSchema.safeParse(fixture.response.body);
      if (!parsed.success) return []; // the absence fixture has no body at all
      return flattenDownloads(parsed.data)
        .map((t) => t.state)
        .filter((s): s is string => s !== undefined);
    });
}

describe(`slskd transfer vocabulary (pinned ${vocabulary.pinnedVersion})`, () => {
  it('describes reachable and unreachable states as disjoint sets', () => {
    const overlap = Object.keys(vocabulary.unreachable).filter((state) => reachable.has(state));
    expect(overlap).toEqual([]);
  });

  it('lists every terminal state among the reachable ones', () => {
    for (const state of vocabulary.terminal) expect(reachable).toContain(state);
  });

  it('finds transfer stubs to check at all', () => {
    // Guards the guard: if the scan stopped matching (a refactor to a fixture builder, say), every
    // per-file check below would pass vacuously.
    const all = transferStubFiles().flatMap((file) =>
      statesIn(readFileSync(`${ADAPTER_DIR}${file}`, 'utf8')),
    );

    expect(all.length).toBeGreaterThan(0);
  });

  it.each(transferStubFiles())('every transfer state stubbed in %s is reachable', (file) => {
    const states = statesIn(readFileSync(`${ADAPTER_DIR}${file}`, 'utf8'));

    for (const state of states) {
      expect(
        reachable,
        `${file} stubs '${state}', which slskd ${vocabulary.pinnedVersion} cannot serve — see transfer-vocabulary.json`,
      ).toContain(state);
    }
  });

  it('records no state the pinned version cannot serve', () => {
    // The recordings are the ground truth the stubs are held to, so a recording that fell outside
    // the vocabulary would mean this file, not the fixture, is the thing that is wrong.
    for (const state of recordedStates()) expect(reachable).toContain(state);
  });

  it('every transfer state stubbed in the E2E slskd doubles is reachable', () => {
    const states = [...e2eStubStates(), ...e2eInlineStates()];

    expect(states.length).toBeGreaterThan(0);
    for (const state of states) {
      expect(
        reachable,
        `an E2E slskd double stubs '${state}', which slskd ${vocabulary.pinnedVersion} cannot serve`,
      ).toContain(state);
    }
  });

  it('records only fixtures captured from the pinned version', () => {
    // Without this, re-recording against a newer slskd leaves the vocabulary describing the old one
    // for as long as the new version's states happen to be a subset — green, and a lie.
    for (const { name, fixture } of loadFixtures('slskd')) {
      expect(
        fixture.provenance.serviceVersion,
        `${name} was captured from a version this vocabulary does not describe`,
      ).toMatch(new RegExp(`^${vocabulary.pinnedVersion.replaceAll('.', String.raw`\.`)}`));
    }
  });

  it('witnesses every terminal state with a fixture recorded from a real slskd', () => {
    // What makes a version bump force a re-record: on a new slskd the terminal set changes, and
    // this fails until someone runs the lab against it rather than editing the list.
    const recorded = new Set(recordedStates());

    for (const state of vocabulary.terminal) {
      expect(recorded, `no recorded fixture witnesses '${state}'`).toContain(state);
    }
  });
});

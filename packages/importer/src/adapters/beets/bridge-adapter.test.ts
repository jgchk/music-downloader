import { testContext, testScope } from '../../application/__fixtures__/correlation.js';
import { describe, expect, it, vi } from 'vitest';
import { silentLogger } from '../../application/__fixtures__/fakes.js';
import { createLogger } from '../../application/logging/logger.js';
import type { ApplyMode, ManualTags } from '../../domain/import/events.js';
import { toPositiveInt } from '../../domain/shared/positive-int.js';
import { BeetsBridge, defaultBridgeScript } from './bridge-adapter.js';
import type { BeetsBridgeConfig } from './bridge-adapter.js';
import type { CommandResult, CommandRunner } from './runner.js';

const CONFIG: BeetsBridgeConfig = {
  pythonBin: '/opt/venv/bin/python3',
  beetsConfigPath: '/config/beets/config.yaml',
  timeoutMs: 1000,
  bridgeScript: '/app/bridge.py',
};

const PROPOSAL_JSON = JSON.stringify({
  status: 'proposal',
  candidates: [
    {
      data_source: 'MusicBrainz',
      album_id: 'mb-album-1',
      artist: 'The Beatles',
      album: 'Love Me Do',
      distance: 0.01,
      penalties: [{ name: 'year', amount: 0.01 }],
      tracks: [{ path: '/intake/a/01.mp3', title: 'Love Me Do', index: 1 }],
    },
  ],
  duplicates: [{ artist: 'The Beatles', album: 'Love Me Do', path: '/library/b/lmd' }],
});

function completed(stdout: string, over: Partial<CommandResult> = {}): CommandResult {
  return { code: 0, stdout, stderr: '', timedOut: false, ...over };
}

function runnerReturning(...results: CommandResult[]): CommandRunner & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    run: vi.fn((_bin: string, arguments_: readonly string[]) => {
      calls.push([...arguments_]);
      return Promise.resolve(results.shift() ?? completed('{}'));
    }),
  };
}

function bridge(runner: CommandRunner, config: BeetsBridgeConfig = CONFIG): BeetsBridge {
  return new BeetsBridge(silentLogger(), config, runner);
}

describe('propose', () => {
  it('passes the pins through and translates the proposal to port vocabulary', async () => {
    const runner = runnerReturning(completed(PROPOSAL_JSON));
    const proposeResult = await bridge(runner).propose(
      '/intake/a',
      {
        searchId: 'mb-1',
        searchArtist: 'The Beatles',
        searchAlbum: 'Love Me Do',
      },
      testScope(),
    );
    const outcome = proposeResult._unsafeUnwrap();

    expect(runner.calls[0]).toEqual([
      '/app/bridge.py',
      '--config',
      '/config/beets/config.yaml',
      'propose',
      '/intake/a',
      '--search-id',
      'mb-1',
      '--search-artist',
      'The Beatles',
      '--search-album',
      'Love Me Do',
    ]);
    expect(outcome).toEqual({
      kind: 'proposal',
      candidates: [
        {
          ref: { dataSource: 'MusicBrainz', albumId: 'mb-album-1' },
          artist: 'The Beatles',
          album: 'Love Me Do',
          distance: 0.01,
          penalties: [{ name: 'year', amount: 0.01 }],
          tracks: [{ path: '/intake/a/01.mp3', title: 'Love Me Do', index: 1 }],
        },
      ],
      duplicates: [{ artist: 'The Beatles', album: 'Love Me Do', path: '/library/b/lmd' }],
    });
  });

  it('carries the field-level diff evidence into the domain candidate (snake→camel)', async () => {
    const enriched = JSON.stringify({
      status: 'proposal',
      candidates: [
        {
          data_source: 'MusicBrainz',
          album_id: 'mb-album-1',
          artist: 'The Beatles',
          album: 'Love Me Do',
          distance: 0.2,
          penalties: [{ name: 'tracks', amount: 0.1 }],
          tracks: [
            {
              path: '/intake/a/01.mp3',
              title: 'Love Me Do',
              index: 1,
              current: { title: 'Luv Me Do', artist: 'Beatles', track: 1, length: 143.1 },
              distance: 0.125,
            },
          ],
          extra_items: [{ path: '/intake/a/99.mp3', title: 'Bonus Beatz', track: 9 }],
          extra_tracks: [{ title: 'P.S. I Love You', index: 2 }],
          album_fields: {
            year: 1988,
            media: '8cm CD',
            label: 'Parlophone',
            catalognum: 'CD3R 4949',
            country: 'XE',
            albumdisambig: 'mini CD',
          },
        },
      ],
      duplicates: [],
    });
    const proposeResult2 = await bridge(runnerReturning(completed(enriched))).propose(
      '/intake/a',
      {},
      testScope(),
    );
    const outcome = proposeResult2._unsafeUnwrap();
    expect(outcome).toMatchObject({
      kind: 'proposal',
      candidates: [
        {
          ref: { dataSource: 'MusicBrainz', albumId: 'mb-album-1' },
          tracks: [
            {
              path: '/intake/a/01.mp3',
              title: 'Love Me Do',
              index: 1,
              current: { title: 'Luv Me Do', artist: 'Beatles', track: 1, length: 143.1 },
              distance: 0.125,
            },
          ],
          extraItems: [{ path: '/intake/a/99.mp3', title: 'Bonus Beatz', track: 9 }],
          missingTracks: [{ title: 'P.S. I Love You', index: 2 }],
          albumFields: {
            year: 1988,
            media: '8cm CD',
            label: 'Parlophone',
            catalognum: 'CD3R 4949',
            country: 'XE',
            albumDisambig: 'mini CD',
          },
        },
      ],
    });
  });

  it('omits pin flags when no hints were supplied', async () => {
    const runner = runnerReturning(
      completed(JSON.stringify({ status: 'proposal', candidates: [], duplicates: [] })),
    );
    await bridge(runner).propose('/intake/a', {}, testScope());
    expect(runner.calls[0]).toEqual([
      '/app/bridge.py',
      '--config',
      '/config/beets/config.yaml',
      'propose',
      '/intake/a',
    ]);
  });

  it('translates a bridge refusal to a doomed outcome', async () => {
    const runner = runnerReturning(
      completed(JSON.stringify({ status: 'doomed', kind: 'directory-not-found', reason: 'gone' })),
    );
    const proposeResult3 = await bridge(runner).propose('/intake/a', {}, testScope());
    const outcome = proposeResult3._unsafeUnwrap();
    expect(outcome).toEqual({ kind: 'doomed', reason: 'gone' });
  });
});

describe('apply', () => {
  const APPLIED = completed(
    JSON.stringify({ status: 'applied', location: '/library/b/lmd', failures: [] }),
  );

  const modeCases: readonly (readonly [ApplyMode, readonly string[]])[] = [
    [
      { kind: 'candidate', ref: { dataSource: 'MusicBrainz', albumId: 'a1' } },
      ['--candidate', 'MusicBrainz:a1'],
    ],
    [
      {
        kind: 'candidate',
        ref: { dataSource: 'MusicBrainz', albumId: 'a1' },
        duplicateAction: 'replace',
      },
      ['--candidate', 'MusicBrainz:a1', '--duplicate-action', 'replace'],
    ],
    [
      {
        kind: 'candidate',
        ref: { dataSource: 'MusicBrainz', albumId: 'a1' },
        duplicateAction: 'keep-both',
      },
      ['--candidate', 'MusicBrainz:a1', '--duplicate-action', 'keep-both'],
    ],
    [{ kind: 'as-is' }, ['--as-is']],
  ];

  it.each(modeCases)('builds the apply arguments for %j', async (mode, expected) => {
    const runner = runnerReturning(APPLIED);
    const applyResult = await bridge(runner).apply('/intake/a', mode, testScope());
    const outcome = applyResult._unsafeUnwrap();
    expect(runner.calls[0]).toEqual([
      '/app/bridge.py',
      '--config',
      '/config/beets/config.yaml',
      'apply',
      '/intake/a',
      ...expected,
    ]);
    expect(outcome).toEqual({ kind: 'applied', location: '/library/b/lmd', failures: [] });
  });

  it('serializes a manual tag payload onto the command line', async () => {
    const runner = runnerReturning(APPLIED);
    const tags: ManualTags = {
      albumArtist: 'Jake Tape',
      album: 'Handmade',
      tracks: [{ path: 'a.mp3', title: 'First', trackNumber: toPositiveInt(1) }],
    };
    await bridge(runner).apply('/intake/a', { kind: 'manual-tags', tags }, testScope());
    expect(runner.calls[0]!.slice(-2)).toEqual(['--tags', JSON.stringify(tags)]);
  });

  it('translates a duplicate skip', async () => {
    const runner = runnerReturning(
      completed(JSON.stringify({ status: 'skipped-duplicate', incumbents: [] })),
    );
    const applyResult2 = await bridge(runner).apply('/intake/a', { kind: 'as-is' }, testScope());
    const outcome = applyResult2._unsafeUnwrap();
    expect(outcome).toEqual({ kind: 'skipped-duplicate', incumbents: [] });
  });

  it('carries a non-empty enrichment failures[] element ({stage, message}) through to the outcome', async () => {
    // Every recorded apply fixture has `failures: []`, so the applyFailureSchema element otherwise
    // has zero real-data coverage: a partially-failed apply carries each {stage, message} through.
    const runner = runnerReturning(
      completed(
        JSON.stringify({
          status: 'applied',
          location: '/library/b/lmd',
          failures: [{ stage: 'import-pipeline', message: 'fetchart timed out' }],
        }),
      ),
    );
    const applyResultFailures = await bridge(runner).apply(
      '/intake/a',
      { kind: 'as-is' },
      testScope(),
    );
    const outcome = applyResultFailures._unsafeUnwrap();
    expect(outcome).toEqual({
      kind: 'applied',
      location: '/library/b/lmd',
      failures: [{ stage: 'import-pipeline', message: 'fetchart timed out' }],
    });
  });

  it('reports a failed apply under its own operation, not another verb’s', async () => {
    // The three verbs fail into one retryable InfraError, so the operation is what tells an
    // operator (and a dead letter) which bridge call stalled the import.
    const runner = runnerReturning(completed('', { code: 1, stderr: 'boom' }));

    const applyFailure = await bridge(runner).apply('/intake/a', { kind: 'as-is' }, testScope());

    expect(applyFailure._unsafeUnwrapErr()).toMatchObject({
      kind: 'InfraError',
      operation: 'bridge.apply',
    });
  });

  it('translates an apply refusal to a doomed outcome', async () => {
    const runner = runnerReturning(
      completed(JSON.stringify({ status: 'doomed', kind: 'candidate-not-found', reason: 'nope' })),
    );
    const applyResult3 = await bridge(runner).apply('/intake/a', { kind: 'as-is' }, testScope());
    const outcome = applyResult3._unsafeUnwrap();
    expect(outcome).toEqual({ kind: 'doomed', reason: 'nope' });
  });
});

describe('validate', () => {
  it('translates the effective configuration', async () => {
    const runner = runnerReturning(
      completed(
        JSON.stringify({
          status: 'valid',
          beets_version: '2.12.0',
          library_database: '/config/beets/library.db',
          library_directory: '/music/library',
          plugins: ['musicbrainz', 'fetchart'],
          overlay: { import: { resume: false } },
        }),
      ),
    );
    const validateResult = await bridge(runner).validate();
    const config = validateResult._unsafeUnwrap();
    expect(runner.calls[0]).toEqual([
      '/app/bridge.py',
      '--config',
      '/config/beets/config.yaml',
      'validate',
    ]);
    expect(config).toEqual({
      beetsVersion: '2.12.0',
      libraryDatabase: '/config/beets/library.db',
      libraryDirectory: '/music/library',
      plugins: ['musicbrainz', 'fetchart'],
      overlay: { import: { resume: false } },
    });
  });

  it('maps an unusable configuration to the non-retryable ConfigInvalid, not a retryable InfraError', async () => {
    const runner = runnerReturning(
      completed(JSON.stringify({ status: 'invalid', kind: 'config-invalid', reason: 'bad yaml' })),
    );
    const validateResult2 = await bridge(runner).validate();
    const error = validateResult2._unsafeUnwrapErr();
    // An operator-fixable config must never be classified as a retry-worthy infrastructure fault.
    expect(error).toEqual({ kind: 'ConfigInvalid', detail: 'config-invalid: bad yaml' });
  });

  it('still maps a genuine validate fault (spawn/contract) to a retryable InfraError', async () => {
    const runner = runnerReturning(completed('not json'));
    const validateResult3 = await bridge(runner).validate();
    expect(validateResult3._unsafeUnwrapErr()).toMatchObject({
      kind: 'InfraError',
      operation: 'bridge.validate',
    });
  });
});

describe('failure surfaces', () => {
  // Every fault below is the same retryable InfraError from the same verb, so each test pins the
  // operation as well as the message: together they are the whole of what an operator gets when
  // the reactor parks or dead-letters the effect.
  it('maps a timeout to an InfraError', async () => {
    const runner = runnerReturning(completed('', { timedOut: true }));
    const proposeResult4 = await bridge(runner).propose('/intake/a', {}, testScope());
    const error = proposeResult4._unsafeUnwrapErr();
    expect(error.operation).toBe('bridge.propose');
    expect(error.message).toContain('timed out after 1000ms');
  });

  it('maps a non-zero exit to an InfraError carrying stderr', async () => {
    const runner = runnerReturning(completed('', { code: 1, stderr: 'Traceback: boom' }));
    const proposeResult5 = await bridge(runner).propose('/intake/a', {}, testScope());
    const error = proposeResult5._unsafeUnwrapErr();
    expect(error.operation).toBe('bridge.propose');
    expect(error.message).toContain('bridge exited 1');
    expect(error.message).toContain('Traceback: boom');
  });

  it('keeps the tail of a flood of stderr, where a Python traceback names its cause', async () => {
    // This message is persisted on the parked effect and read by an operator. An unbounded dump
    // of the bridge's stderr would bury the cause — which, in a traceback, is at the very end.
    const runner = runnerReturning(
      completed('', { code: 1, stderr: `${'x'.repeat(5000)}\nValueError: no such album` }),
    );
    const floodResult = await bridge(runner).propose('/intake/a', {}, testScope());
    const error = floodResult._unsafeUnwrapErr();
    expect(error.message).toContain('ValueError: no such album');
    expect(error.message).not.toContain('x'.repeat(2001));
  });

  it('reports a signal-terminated bridge distinctly', async () => {
    const runner = runnerReturning(completed('', { code: null }));
    const proposeResult6 = await bridge(runner).propose('/intake/a', {}, testScope());
    const error = proposeResult6._unsafeUnwrapErr();
    expect(error.message).toContain('by signal');
  });

  it('surfaces stderr from a successful run as a warn line, never a swallowed string', async () => {
    // The bridge reports partial degradation (e.g. "collect: skipped 3 unreadable file(s)") on
    // stderr while still exiting 0 with a proposal built on the readable subset. The non-zero
    // path already carries stderr in its error; this is the ONLY channel for the success path —
    // dropping it makes the degradation invisible to the operator.
    const lines: string[] = [];
    const logger = createLogger({
      level: 'warn',
      destination: { write: (line: string) => void lines.push(line) },
    });
    const runner = runnerReturning(
      completed(PROPOSAL_JSON, { stderr: 'collect: skipped 3 unreadable file(s)\n' }),
    );
    const proposeOk = await new BeetsBridge(logger, CONFIG, runner).propose(
      '/intake/a',
      {},
      {
        context: testContext(),
        logger,
      },
    );
    expect(proposeOk.isOk()).toBe(true);
    const joined = lines.join('');
    expect(joined).toContain('bridge reported diagnostics on a successful run');
    expect(joined).toContain('skipped 3 unreadable');
    expect(joined).toContain('propose');
  });

  // Whitespace is not a diagnostic: a bridge that exits 0 having written only a stray newline has
  // reported nothing, and warning on it would cry wolf on runs that are entirely healthy.
  it.each([
    ['nothing at all', ''],
    ['a bare newline', '\n'],
    ['blank padding', ' \n\t '],
  ])('stays quiet when a successful run writes %s to stderr', async (_case, stderr) => {
    const lines: string[] = [];
    const logger = createLogger({
      level: 'warn',
      destination: { write: (line: string) => void lines.push(line) },
    });
    const runner = runnerReturning(completed(PROPOSAL_JSON, { stderr }));
    const proposeQuiet = await new BeetsBridge(logger, CONFIG, runner).propose(
      '/intake/a',
      {},
      {
        context: testContext(),
        logger,
      },
    );
    expect(proposeQuiet.isOk()).toBe(true);
    expect(lines).toHaveLength(0);
  });

  it('maps non-JSON output to an InfraError', async () => {
    const runner = runnerReturning(completed('not json'));
    const proposeResult7 = await bridge(runner).propose('/intake/a', {}, testScope());
    const error = proposeResult7._unsafeUnwrapErr();
    expect(error.message).toContain('non-JSON output');
  });

  it('keeps the head of a flood of non-JSON output, where the garbage begins', async () => {
    // The opposite end from stderr, deliberately: what a `JSON.parse` failure needs is the start
    // of the output — the traceback or usage banner the bridge printed instead of a document.
    const runner = runnerReturning(completed(`Usage: bridge.py [-h]\n${'y'.repeat(5000)}`));
    const floodResult = await bridge(runner).propose('/intake/a', {}, testScope());
    const error = floodResult._unsafeUnwrapErr();
    expect(error.message).toContain('Usage: bridge.py');
    expect(error.message).not.toContain('y'.repeat(501));
  });

  it('maps contract drift (schema mismatch) to an InfraError, never silent misbehavior', async () => {
    const runner = runnerReturning(completed(JSON.stringify({ status: 'proposal' })));
    const proposeResult8 = await bridge(runner).propose('/intake/a', {}, testScope());
    const error = proposeResult8._unsafeUnwrapErr();
    expect(error.operation).toBe('bridge.propose');
    expect(error.message).toContain('contract validation');
  });

  it('rejects an out-of-range candidate distance at the [0, 1] parse edge (never a misroute)', async () => {
    // The overall distance is the branded Distance the auto-apply routing turns on: a drifted
    // 1.5 must fail contract validation as an InfraError, never brand-through as a flawless match.
    const runner = runnerReturning(
      completed(
        JSON.stringify({
          status: 'proposal',
          candidates: [
            {
              data_source: 'MusicBrainz',
              album_id: 'mb-album-1',
              artist: 'A',
              album: 'B',
              distance: 1.5,
              penalties: [],
              tracks: [],
            },
          ],
          duplicates: [],
        }),
      ),
    );
    const distanceResult = await bridge(runner).propose('/intake/a', {}, testScope());
    const error = distanceResult._unsafeUnwrapErr();
    expect(error).toMatchObject({ kind: 'InfraError' });
    expect(error.message).toContain('contract validation');
  });

  it('rejects an out-of-range per-track distance at the same [0, 1] parse edge', async () => {
    // The per-track distance is branded at the same edge (TrackMapping.distance): a drifted 1.5
    // must fail contract validation, never brand-through into the domain.
    const runner = runnerReturning(
      completed(
        JSON.stringify({
          status: 'proposal',
          candidates: [
            {
              data_source: 'MusicBrainz',
              album_id: 'mb-album-1',
              artist: 'A',
              album: 'B',
              distance: 0.1,
              penalties: [],
              tracks: [{ path: '/intake/a/01.mp3', title: 'T', index: 1, distance: 1.5 }],
            },
          ],
          duplicates: [],
        }),
      ),
    );
    const trackDistanceResult = await bridge(runner).propose('/intake/a', {}, testScope());
    const error = trackDistanceResult._unsafeUnwrapErr();
    expect(error).toMatchObject({ kind: 'InfraError' });
    expect(error.message).toContain('contract validation');
  });

  it('maps a spawn rejection to an InfraError', async () => {
    const runner: CommandRunner = { run: () => Promise.reject(new Error('ENOENT')) };
    const proposeResult9 = await bridge(runner).propose('/intake/a', {}, testScope());
    const error = proposeResult9._unsafeUnwrapErr();
    expect(error.operation).toBe('bridge.propose');
    expect(error.message).toContain('bridge spawn failed');
  });
});

describe('serialization (design D6)', () => {
  it('runs at most one bridge invocation at a time', async () => {
    let active = 0;
    let peak = 0;
    // Each invocation blocks on a caller-controlled gate (no wall-clock sleep): the test releases
    // them one at a time and observes that a second never starts while the first is in flight.
    const gates: (() => void)[] = [];
    const runner: CommandRunner = {
      run: async () => {
        active += 1;
        peak = Math.max(peak, active);
        const { promise, resolve } = Promise.withResolvers<void>();
        gates.push(resolve);
        await promise;
        active -= 1;
        return completed(JSON.stringify({ status: 'proposal', candidates: [], duplicates: [] }));
      },
    };
    const adapter = bridge(runner);
    const results = Promise.all([
      adapter.propose('/intake/a', {}, testScope()),
      adapter.propose('/intake/b', {}, testScope()),
      adapter.propose('/intake/c', {}, testScope()),
    ]);

    // Only one invocation is ever in flight: each releases the queue's next only once it completes.
    for (let index = 0; index < 3; index += 1) {
      await vi.waitFor(() => expect(gates).toHaveLength(index + 1));
      gates[index]!();
    }

    const settled = await results;
    expect(settled.every((result) => result.isOk())).toBe(true);
    expect(peak).toBe(1);
  });

  it('keeps the queue moving after a failed invocation', async () => {
    const runner = runnerReturning(
      completed('', { code: 1, stderr: 'boom' }),
      completed(JSON.stringify({ status: 'proposal', candidates: [], duplicates: [] })),
    );
    const adapter = bridge(runner);
    const [first, second] = await Promise.all([
      adapter.propose('/intake/a', {}, testScope()),
      adapter.propose('/intake/b', {}, testScope()),
    ]);
    expect(first.isErr()).toBe(true);
    expect(second.isOk()).toBe(true);
  });
});

describe('defaults', () => {
  it('resolves the shipped bridge.py beside the module by default', async () => {
    expect(defaultBridgeScript()).toMatch(/adapters\/beets\/bridge\/bridge\.py$/u);
    const runner = runnerReturning(
      completed(JSON.stringify({ status: 'proposal', candidates: [], duplicates: [] })),
    );
    const adapter = new BeetsBridge(silentLogger(), { ...CONFIG, bridgeScript: undefined }, runner);
    await adapter.propose('/intake/a', {}, testScope());
    expect(runner.calls[0]![0]).toMatch(/bridge\/bridge\.py$/u);
  });
});

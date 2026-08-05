import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { err, ok } from 'neverthrow';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { createDownloaderRuntime, DownloaderRuntime } from '@music/downloader/runtime';
import type { createImporterRuntime, ImporterRuntime } from '@music/importer/runtime';
import { PlexTvAccess } from './plex/adapter.js';
import {
  accessOf,
  bootRuntimes,
  facadesOf,
  loggerOf,
  readinessOf,
  resetRuntimesForTesting,
} from './runtime.js';

/** The shipped product version — read straight from the workspace root package.json (design D5). */
const shippedVersion = (
  JSON.parse(readFileSync(new URL('../../../../../package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;

/**
 * The composed boot path (design D8, runtime-baseline): module runtimes and both seam
 * subscriptions are started BEFORE the interface serves anything; boots are shared; shutdown
 * stops subscriptions and runtimes. Fake factories record ordering — the full-process proof
 * lives in the e2e tier (group 8).
 */

const VALID_ENV = {
  LIBRARY_ROOT: '/library',
  STAGING_ROOT: '/staging',
  INTAKE_ROOT: '/intake',
  BEETS_CONFIG: '/config/beets.yaml',
  SESSION_SECRET: 'runtime-test-secret-0123456789abcd',
  PLEX_SERVER_MACHINE_ID: 'runtime-machine',
};

function fakeSubscription(log: string[], name: string) {
  return {
    start: () => {
      log.push(`${name}:start`);
      return Promise.resolve();
    },
    stop: () => {
      log.push(`${name}:stop`);
    },
  };
}

function fakeRuntimes(
  log: string[],
  statuses: { downloader?: 'up' | 'down'; importer?: 'up' | 'down' } = {},
  failures: { acquisitionsStart?: boolean } = {},
) {
  // Each seam must be wired to the OTHER module's feed and wakeups; capturing what each connect call
  // received lets a test catch a cross-wiring (e.g. handing the verdict seam the downloader's own
  // feed) that mere subscription-lifecycle assertions would pass green.
  const captured: {
    verdict?: { feed: unknown; wakeups: unknown };
    acquisition?: { feed: unknown; wakeups: unknown };
  } = {};
  const downloader = {
    facade: { kind: 'downloader-facade' },
    feed: { read: vi.fn() },
    wakeups: { subscribe: () => () => {} },
    connectVerdictFeed: (feed: unknown, wakeups: unknown) => {
      captured.verdict = { feed, wakeups };
      return fakeSubscription(log, 'verdicts');
    },
    readiness: () => ({ status: statuses.downloader ?? 'up' }),
    stop: () => {
      log.push('downloader:stop');
      return Promise.resolve();
    },
  } as unknown as DownloaderRuntime;
  const importer = {
    facade: { kind: 'importer-facade' },
    beetsConfig: { beetsVersion: 'x' },
    feed: { read: vi.fn() },
    wakeups: { subscribe: () => () => {} },
    connectAcquisitionFeed: (feed: unknown, options: { sourceRoot: string }, wakeups: unknown) => {
      log.push(`acquisitions:connect:${options.sourceRoot}`);
      captured.acquisition = { feed, wakeups };
      return failures.acquisitionsStart
        ? {
            start: () => Promise.reject(new Error('subscription start defect')),
            stop: () => {
              log.push('acquisitions:stop');
            },
          }
        : fakeSubscription(log, 'acquisitions');
    },
    readiness: () => ({ status: statuses.importer ?? 'up' }),
    stop: () => {
      log.push('importer:stop');
      return Promise.resolve();
    },
  } as unknown as ImporterRuntime;
  return {
    downloader,
    importer,
    captured,
    createDownloader: vi.fn(() => {
      log.push('downloader:create');
      return Promise.resolve(ok(downloader));
    }),
    createImporter: vi.fn(() => {
      log.push('importer:create');
      return Promise.resolve(ok(importer));
    }),
  };
}

afterEach(async () => {
  await resetRuntimesForTesting();
});

describe('bootRuntimes', () => {
  it('boots both runtimes and starts both seam subscriptions before resolving', async () => {
    const log: string[] = [];
    const fakes = fakeRuntimes(log);
    const onShutdownSignal = vi.fn();

    const booted = await bootRuntimes(VALID_ENV, {
      createDownloader: fakes.createDownloader,
      createImporter: fakes.createImporter,
      onShutdownSignal,
    });

    expect(log).toEqual([
      'downloader:create',
      'importer:create',
      'acquisitions:connect:/library',
      'acquisitions:start',
      'verdicts:start',
    ]);
    expect(booted.facades.downloader).toBe(fakes.downloader.facade);
    expect(booted.facades.importer).toBe(fakes.importer.facade);
    // Each seam is wired to the OTHER module's feed and wakeups: the downloader tails the importer's
    // verdicts, the importer tails the downloader's acquisitions — never a module's own feed.
    expect(fakes.captured.verdict?.feed).toBe(fakes.importer.feed);
    expect(fakes.captured.verdict?.wakeups).toBe(fakes.importer.wakeups);
    expect(fakes.captured.acquisition?.feed).toBe(fakes.downloader.feed);
    expect(fakes.captured.acquisition?.wakeups).toBe(fakes.downloader.wakeups);
    expect(onShutdownSignal).toHaveBeenCalledOnce();
    expect(facadesOf()).toBe(booted.facades);
    // The pino root is exposed to routes so degraded reads can leave a trace.
    expect(loggerOf()).toBe(booted.logger);
    expect(typeof loggerOf().warn).toBe('function');
  });

  it('shares one boot across repeated calls', async () => {
    const log: string[] = [];
    const fakes = fakeRuntimes(log);
    const overrides = {
      createDownloader: fakes.createDownloader,
      createImporter: fakes.createImporter,
      onShutdownSignal: vi.fn(),
    };
    const [first, second] = await Promise.all([
      bootRuntimes(VALID_ENV, overrides),
      bootRuntimes(VALID_ENV, overrides),
    ]);
    expect(second).toBe(first);
    expect(fakes.createDownloader).toHaveBeenCalledOnce();
  });

  it('shutdown stops subscriptions before runtimes and tears the singleton down', async () => {
    const log: string[] = [];
    const fakes = fakeRuntimes(log);
    let captured: (() => Promise<void>) | undefined;
    await bootRuntimes(VALID_ENV, {
      createDownloader: fakes.createDownloader,
      createImporter: fakes.createImporter,
      onShutdownSignal: (shutdown) => {
        captured = shutdown;
      },
    });

    log.length = 0;
    await captured!();
    expect(log).toEqual(['acquisitions:stop', 'verdicts:stop', 'downloader:stop', 'importer:stop']);
    expect(() => facadesOf()).toThrow(/not booted/);
  });

  it('fails fast on an invalid environment, naming the setting', async () => {
    await expect(bootRuntimes({}, {})).rejects.toThrow(/LIBRARY_ROOT/);
  });

  it('stops the downloader and fails when the importer cannot start', async () => {
    const log: string[] = [];
    const fakes = fakeRuntimes(log);
    const failingImporter = vi.fn((() =>
      Promise.resolve(
        err({ kind: 'BeetsConfigUnusable', detail: 'bad yaml' }),
      )) as unknown as typeof createImporterRuntime);

    await expect(
      bootRuntimes(VALID_ENV, {
        createDownloader: fakes.createDownloader,
        createImporter: failingImporter,
        onShutdownSignal: vi.fn(),
      }),
    ).rejects.toThrow(/bad yaml/);
    expect(log).toContain('downloader:stop');
  });

  it('fails when the downloader cannot start, before the importer ever boots', async () => {
    const log: string[] = [];
    const fakes = fakeRuntimes(log);
    const failingDownloader = vi.fn((() =>
      Promise.resolve(
        err({ kind: 'ProjectionRebuildFailed', detail: 'backlog unreadable' }),
      )) as unknown as typeof createDownloaderRuntime);

    await expect(
      bootRuntimes(VALID_ENV, {
        createDownloader: failingDownloader,
        createImporter: fakes.createImporter,
        onShutdownSignal: vi.fn(),
      }),
    ).rejects.toThrow(/downloader startup failed: backlog unreadable/);
    expect(log).not.toContain('importer:create'); // nothing else booted, nothing to stop
  });

  it('tears both runtimes down when a seam subscription fails to start', async () => {
    // A subscription whose start() THROWS (a defect, not a modeled failure) must not strand two
    // booted runtimes with live pollers behind a rejected boot — everything already started stops.
    const log: string[] = [];
    const fakes = fakeRuntimes(log, {}, { acquisitionsStart: true });

    await expect(
      bootRuntimes(VALID_ENV, {
        createDownloader: fakes.createDownloader,
        createImporter: fakes.createImporter,
        onShutdownSignal: vi.fn(),
      }),
    ).rejects.toThrow(/subscription start defect/);
    expect(log).toContain('acquisitions:stop');
    expect(log).toContain('verdicts:stop');
    expect(log).toContain('downloader:stop');
    expect(log).toContain('importer:stop');
  });

  it('logs, rather than loses, a rejection from the signal-driven shutdown', async () => {
    // The default registration fires `void shutdown()` from a process event: a rejection there
    // has no awaiting caller, so unobserved it would be an unhandled rejection at teardown.
    const log: string[] = [];
    const fakes = fakeRuntimes(log);
    await bootRuntimes(VALID_ENV, {
      createDownloader: fakes.createDownloader,
      createImporter: fakes.createImporter,
    });
    const errorSpy = vi.spyOn(loggerOf(), 'error');
    fakes.downloader.stop = () => Promise.reject(new Error('close raced'));

    (process.emit as (event: string) => boolean)('sveltekit:shutdown');

    await vi.waitFor(() => {
      const messages = errorSpy.mock.calls.map((call) => String(call.at(-1)));
      expect(messages).toContain('shutdown failed');
    });
    fakes.downloader.stop = () => Promise.resolve(); // let afterEach tear down cleanly
  });

  it('composes the access surface: the configured session secret and the real plex.tv adapter', async () => {
    const fakes = fakeRuntimes([]);
    await bootRuntimes(VALID_ENV, {
      createDownloader: fakes.createDownloader,
      createImporter: fakes.createImporter,
      onShutdownSignal: vi.fn(),
    });
    const access = accessOf();
    expect(access.sessionSecret).toBe('runtime-test-secret-0123456789abcd');
    // The one concretion behind the PlexAccess port is constructed HERE (design D6): no fake, no
    // null strategy, nothing an environment value could select instead (design D7).
    expect(access.plex).toBeInstanceOf(PlexTvAccess);
  });

  it('facadesOf refuses before boot', () => {
    expect(() => facadesOf()).toThrow(/init hook/);
  });

  it('accessOf refuses before boot', () => {
    expect(() => accessOf()).toThrow(/init hook/);
  });

  it('loggerOf refuses before boot', () => {
    expect(() => loggerOf()).toThrow(/init hook/);
  });

  it('registers the adapter-node shutdown signal by default', async () => {
    const log: string[] = [];
    const fakes = fakeRuntimes(log);
    await bootRuntimes(VALID_ENV, {
      createDownloader: fakes.createDownloader,
      createImporter: fakes.createImporter,
    });

    (process.emit as (event: string) => boolean)('sveltekit:shutdown');
    await vi.waitFor(() => {
      expect(() => facadesOf()).toThrow(/not booted/);
    });
    expect(log).toContain('downloader:stop');
  });

  it('boots the real module factories when no overrides are given (importer fails on beets)', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'composed-'));
    try {
      await expect(
        bootRuntimes({
          LIBRARY_ROOT: path.join(directory, 'library'),
          STAGING_ROOT: path.join(directory, 'staging'),
          INTAKE_ROOT: path.join(directory, 'intake'),
          BEETS_CONFIG: path.join(directory, 'beets.yaml'),
          DOWNLOADER_DATABASE_FILE: ':memory:',
          IMPORTER_DATABASE_FILE: ':memory:',
          BRIDGE_PYTHON: '/bin/false',
          BRIDGE_TIMEOUT_MS: '2000',
          LOG_LEVEL: 'silent',
          SESSION_SECRET: 'real-boot-secret-0123456789abcdef',
          PLEX_SERVER_MACHINE_ID: 'real-boot-machine',
        }),
      ).rejects.toThrow(/importer startup failed/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe('readinessOf', () => {
  async function boot(statuses: { downloader?: 'up' | 'down'; importer?: 'up' | 'down' } = {}) {
    const fakes = fakeRuntimes([], statuses);
    await bootRuntimes(VALID_ENV, {
      createDownloader: fakes.createDownloader,
      createImporter: fakes.createImporter,
      onShutdownSignal: vi.fn(),
    });
  }

  it('composes both booted runtimes into ok with the shipped version when all up', async () => {
    await boot();
    expect(readinessOf()).toEqual({
      status: 'ok',
      version: shippedVersion,
      modules: { downloader: { status: 'up' }, importer: { status: 'up' } },
    });
  });

  it('reports the version from the shipped package, not the environment', async () => {
    await boot();
    // The value tracks the workspace root package.json version — no env var is consulted.
    expect(readinessOf().version).toBe(shippedVersion);
    expect(process.env.APP_VERSION).toBeUndefined();
  });

  it('reports degraded and names the downloader when it is down', async () => {
    await boot({ downloader: 'down' });
    const readiness = readinessOf();
    expect(readiness.status).toBe('degraded');
    expect(readiness.modules).toEqual({
      downloader: { status: 'down' },
      importer: { status: 'up' },
    });
  });

  it('reports degraded and names the importer when it is down', async () => {
    await boot({ importer: 'down' });
    const readiness = readinessOf();
    expect(readiness.status).toBe('degraded');
    expect(readiness.modules).toEqual({
      downloader: { status: 'up' },
      importer: { status: 'down' },
    });
  });

  it('refuses before boot (values only after the init hook has run)', () => {
    expect(() => readinessOf()).toThrow(/not booted/);
  });
});

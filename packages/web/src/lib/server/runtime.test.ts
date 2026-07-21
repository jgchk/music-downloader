import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { err, ok } from 'neverthrow';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DownloaderRuntime } from '@music/downloader/runtime';
import type { createImporterRuntime, ImporterRuntime } from '@music/importer/runtime';
import { bootRuntimes, facadesOf, resetRuntimesForTesting } from './runtime.js';

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
};

function fakeSubscription(log: string[], name: string) {
  return {
    start: () => {
      log.push(`${name}:start`);
      return Promise.resolve();
    },
    stop: () => log.push(`${name}:stop`),
  };
}

function fakeRuntimes(log: string[]) {
  const downloader = {
    facade: { kind: 'downloader-facade' },
    feed: { read: vi.fn() },
    wakeups: { subscribe: () => () => undefined },
    connectVerdictFeed: () => fakeSubscription(log, 'verdicts'),
    stop: () => {
      log.push('downloader:stop');
      return Promise.resolve();
    },
  } as unknown as DownloaderRuntime;
  const importer = {
    facade: { kind: 'importer-facade' },
    beetsConfig: { beetsVersion: 'x' },
    feed: { read: vi.fn() },
    wakeups: { subscribe: () => () => undefined },
    connectAcquisitionFeed: (_feed: unknown, options: { sourceRoot: string }) => {
      log.push(`acquisitions:connect:${options.sourceRoot}`);
      return fakeSubscription(log, 'acquisitions');
    },
    stop: () => {
      log.push('importer:stop');
      return Promise.resolve();
    },
  } as unknown as ImporterRuntime;
  return {
    downloader,
    importer,
    createDownloader: vi.fn(() => {
      log.push('downloader:create');
      return Promise.resolve(downloader);
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
    expect(onShutdownSignal).toHaveBeenCalledOnce();
    expect(facadesOf()).toBe(booted.facades);
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

  it('facadesOf refuses before boot', () => {
    expect(() => facadesOf()).toThrow(/init hook/);
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
    const dir = mkdtempSync(join(tmpdir(), 'composed-'));
    try {
      await expect(
        bootRuntimes({
          LIBRARY_ROOT: join(dir, 'library'),
          STAGING_ROOT: join(dir, 'staging'),
          INTAKE_ROOT: join(dir, 'intake'),
          BEETS_CONFIG: join(dir, 'beets.yaml'),
          DOWNLOADER_DATABASE_FILE: ':memory:',
          IMPORTER_DATABASE_FILE: ':memory:',
          BRIDGE_PYTHON: '/bin/false',
          BRIDGE_TIMEOUT_MS: '2000',
          LOG_LEVEL: 'silent',
        }),
      ).rejects.toThrow(/importer startup failed/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

import { describe, expect, it } from 'vitest';
import { loadComposedConfig } from './config.js';

const VALID = {
  LIBRARY_ROOT: '/library',
  STAGING_ROOT: '/staging',
  INTAKE_ROOT: '/intake',
  BEETS_CONFIG: '/config/beets.yaml',
};

describe('loadComposedConfig', () => {
  it('maps a minimal valid environment onto both module configs with defaults', () => {
    const config = loadComposedConfig(VALID)._unsafeUnwrap();
    expect(config.downloader.databaseFile).toBe('data/downloader/events.db');
    expect(config.importer.databaseFile).toBe('data/importer/events.db');
    expect(config.downloader.stagingRoot).toBe('/staging');
    expect(config.importer.intakeRoot).toBe('/intake');
    expect(config.importer.bridgeTimeoutMs).toBe(600_000);
    expect(config.logLevel).toBe('info');
  });

  it('ignores webhook-era settings entirely (runtime-baseline: inert, never read)', () => {
    const clean = loadComposedConfig(VALID)._unsafeUnwrap();
    const carrying = loadComposedConfig({
      ...VALID,
      WEBHOOK_SUBSCRIBER_URLS: 'http://peer/webhook',
      WEBHOOK_SIGNING_SECRET: 'whsec_abc',
      VERDICT_WEBHOOK_SECRET: 'whsec_def',
      INTAKE_WEBHOOK_SECRET: 'whsec_ghi',
    })._unsafeUnwrap();
    expect(carrying).toEqual(clean);
  });

  it('defaults the intake source root to the library root (delivered locations are deposits)', () => {
    // acquisition.fulfilled carries the DEPOSITED location — the downloader's library root, not
    // its staging root. Defaulting to STAGING_ROOT would reject every delivered location as
    // outside the source namespace (found by the out-of-process e2e tier).
    expect(loadComposedConfig(VALID)._unsafeUnwrap().intakeSourceRoot).toBe('/library');
    expect(
      loadComposedConfig({ ...VALID, INTAKE_SOURCE_ROOT: '/elsewhere' })._unsafeUnwrap()
        .intakeSourceRoot,
    ).toBe('/elsewhere');
  });

  it('carries explicit settings through', () => {
    const config = loadComposedConfig({
      ...VALID,
      LOG_LEVEL: 'debug',
      SLSKD_BASE_URL: 'http://slskd:5030',
      SLSKD_API_KEY: 'key',
      MUSICBRAINZ_BASE_URL: 'http://mb',
      MUSICBRAINZ_USER_AGENT: 'ua',
      DOWNLOADER_DATABASE_FILE: '/data/d.db',
      IMPORTER_DATABASE_FILE: '/data/i.db',
      BRIDGE_PYTHON: '/venv/bin/python',
      BRIDGE_SCRIPT: '/app/bridge.py',
      BRIDGE_TIMEOUT_MS: '1000',
      AUTO_APPLY_THRESHOLD: '0.1',
    })._unsafeUnwrap();
    expect(config.downloader.slskd).toEqual({ baseUrl: 'http://slskd:5030', apiKey: 'key' });
    expect(config.downloader.musicbrainz).toEqual({ baseUrl: 'http://mb', userAgent: 'ua' });
    expect(config.downloader.databaseFile).toBe('/data/d.db');
    expect(config.importer.databaseFile).toBe('/data/i.db');
    expect(config.importer.bridgePython).toBe('/venv/bin/python');
    expect(config.importer.bridgeScript).toBe('/app/bridge.py');
    expect(config.importer.bridgeTimeoutMs).toBe(1000);
    expect(config.importer.autoApplyThreshold).toBe(0.1);
    expect(config.logLevel).toBe('debug');
  });

  it('maps the reactor retry/retention tuning, leaving unset values to runtime defaults', () => {
    const defaults = loadComposedConfig(VALID)._unsafeUnwrap();
    expect(defaults.downloader.reactor).toEqual({ retry: {}, stalledRetentionMs: undefined });

    const tuned = loadComposedConfig({
      ...VALID,
      REACTOR_RETRY_INITIAL_DELAY_MS: '1000',
      REACTOR_RETRY_MAX_DELAY_MS: '60000',
      REACTOR_RETRY_BUDGET_MS: '3600000',
      REACTOR_STALLED_RETENTION_MS: '86400000',
    })._unsafeUnwrap();
    expect(tuned.downloader.reactor).toEqual({
      retry: { initialDelayMs: 1000, maxDelayMs: 60_000, budgetMs: 3_600_000 },
      stalledRetentionMs: 86_400_000,
    });
  });

  it('labels a root-level shape failure as such', () => {
    const error = loadComposedConfig(undefined as never)._unsafeUnwrapErr();
    expect(error).toContain('(root)');
  });

  it('fails naming the offending setting', () => {
    const error = loadComposedConfig({ ...VALID, LIBRARY_ROOT: undefined })._unsafeUnwrapErr();
    expect(error).toContain('LIBRARY_ROOT');
    const bad = loadComposedConfig({ ...VALID, BRIDGE_TIMEOUT_MS: 'soon' })._unsafeUnwrapErr();
    expect(bad).toContain('BRIDGE_TIMEOUT_MS');
  });
});

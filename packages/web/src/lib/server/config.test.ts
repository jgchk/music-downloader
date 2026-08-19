import { describe, expect, it } from 'vitest';
import { loadComposedConfig } from './config.js';

const VALID = {
  DEPOSIT_ROOT: '/library',
  STAGING_ROOT: '/staging',
  INTAKE_ROOT: '/intake',
  BEETS_CONFIG: '/config/beets.yaml',
  SESSION_SECRET: 'test-session-secret-0123456789abcd',
  PLEX_SERVER_MACHINE_ID: 'abc123machine',
};

describe('loadComposedConfig', () => {
  it('maps a minimal valid environment onto both module configs with defaults', () => {
    const config = loadComposedConfig(VALID)._unsafeUnwrap();
    expect(config.downloader.databaseFile).toBe('data/downloader/events.db');
    expect(config.importer.databaseFile).toBe('data/importer/events.db');
    expect(config.downloader.stagingRoot).toBe('/staging');
    expect(config.importer.intakeRoot).toBe('/intake');
    expect(config.importer.bridgeTimeoutMs).toBe(600_000);
    expect(config.downloader.ffmpeg).toEqual({ timeoutMs: 120_000 });
    expect(config.importer.autoApplyThreshold).toBe(0.04);
    expect(config.logLevel).toBe('info');
  });

  it('rejects an auto-apply threshold outside the 0..1 distance range, naming the setting', () => {
    const low = loadComposedConfig({ ...VALID, AUTO_APPLY_THRESHOLD: '-0.1' })._unsafeUnwrapErr();
    expect(low).toContain('AUTO_APPLY_THRESHOLD');
    const high = loadComposedConfig({ ...VALID, AUTO_APPLY_THRESHOLD: '1.5' })._unsafeUnwrapErr();
    expect(high).toContain('AUTO_APPLY_THRESHOLD');
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
      FFMPEG_TIMEOUT_MS: '30000',
      AUTO_APPLY_THRESHOLD: '0.1',
    })._unsafeUnwrap();
    expect(config.downloader.slskd).toEqual({ baseUrl: 'http://slskd:5030', apiKey: 'key' });
    expect(config.downloader.ffmpeg).toEqual({ timeoutMs: 30_000 });
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
    const error = loadComposedConfig({ ...VALID, STAGING_ROOT: undefined })._unsafeUnwrapErr();
    expect(error).toContain('STAGING_ROOT');
    const bad = loadComposedConfig({ ...VALID, BRIDGE_TIMEOUT_MS: 'soon' })._unsafeUnwrapErr();
    expect(bad).toContain('BRIDGE_TIMEOUT_MS');
  });

  it('fails startup precisely when access-control settings are missing or blank (fail closed)', () => {
    // web-access-control: a process must never serve with a weakened gate — absence is fatal.
    const noSecret = loadComposedConfig({
      ...VALID,
      SESSION_SECRET: undefined,
    })._unsafeUnwrapErr();
    expect(noSecret).toContain('SESSION_SECRET');
    const blankSecret = loadComposedConfig({ ...VALID, SESSION_SECRET: '' })._unsafeUnwrapErr();
    expect(blankSecret).toContain('SESSION_SECRET');
    const noMachine = loadComposedConfig({
      ...VALID,
      PLEX_SERVER_MACHINE_ID: undefined,
    })._unsafeUnwrapErr();
    expect(noMachine).toContain('PLEX_SERVER_MACHINE_ID');
    const blankMachine = loadComposedConfig({
      ...VALID,
      PLEX_SERVER_MACHINE_ID: '',
    })._unsafeUnwrapErr();
    expect(blankMachine).toContain('PLEX_SERVER_MACHINE_ID');
  });

  it('rejects a brute-forceable session secret: shorter than 32 characters fails startup', () => {
    // The HMAC secret IS the gate's strength; a short one is a misconfiguration, and
    // misconfiguration fails closed (web-access-control).
    const short = loadComposedConfig({
      ...VALID,
      SESSION_SECRET: 'only-twenty-chars!!',
    })._unsafeUnwrapErr();
    expect(short).toContain('SESSION_SECRET');
  });

  it('rejects a set-but-blank plex.tv base URL rather than silently falling back', () => {
    const blank = loadComposedConfig({ ...VALID, PLEX_API_BASE_URL: '' })._unsafeUnwrapErr();
    expect(blank).toContain('PLEX_API_BASE_URL');
  });

  it('defaults the plex.tv base URL and carries an explicit one through', () => {
    expect(loadComposedConfig(VALID)._unsafeUnwrap().access.plex.baseUrl).toBe(
      'https://plex.tv/api/v2',
    );
    const config = loadComposedConfig({
      ...VALID,
      PLEX_API_BASE_URL: 'http://localhost:8083',
    })._unsafeUnwrap();
    expect(config.access.plex.baseUrl).toBe('http://localhost:8083');
    expect(config.access.sessionSecret).toBe('test-session-secret-0123456789abcd');
    expect(config.access.plex.machineId).toBe('abc123machine');
  });
});

describe('the deposit directory setting', () => {
  const withoutRoot = { ...VALID } as Record<string, string | undefined>;
  delete withoutRoot.DEPOSIT_ROOT;

  it('reads DEPOSIT_ROOT with no deprecation warning', () => {
    const config = loadComposedConfig({ ...withoutRoot, DEPOSIT_ROOT: '/deposit' })._unsafeUnwrap();
    expect(config.downloader.depositRoot).toBe('/deposit');
    expect(config.warnings).toEqual([]);
  });

  it('still honours the legacy LIBRARY_ROOT, warning that DEPOSIT_ROOT is the current name', () => {
    const config = loadComposedConfig({
      ...withoutRoot,
      LIBRARY_ROOT: '/legacy',
    })._unsafeUnwrap();
    expect(config.downloader.depositRoot).toBe('/legacy');
    expect(config.warnings).toHaveLength(1);
    expect(config.warnings[0]).toContain('DEPOSIT_ROOT');
    expect(config.warnings[0]).toContain('LIBRARY_ROOT');
  });

  it('accepts both names silently when they agree', () => {
    const config = loadComposedConfig({
      ...withoutRoot,
      DEPOSIT_ROOT: '/same',
      LIBRARY_ROOT: '/same',
    })._unsafeUnwrap();
    expect(config.downloader.depositRoot).toBe('/same');
    expect(config.warnings).toEqual([]);
  });

  it('fails startup when the two names disagree, naming both', () => {
    const error = loadComposedConfig({
      ...withoutRoot,
      DEPOSIT_ROOT: '/one',
      LIBRARY_ROOT: '/two',
    })._unsafeUnwrapErr();
    expect(error).toContain('DEPOSIT_ROOT');
    expect(error).toContain('LIBRARY_ROOT');
  });

  it('fails startup when neither name is set, naming the current one', () => {
    const error = loadComposedConfig(withoutRoot)._unsafeUnwrapErr();
    expect(error).toContain('DEPOSIT_ROOT');
  });

  it('defaults the intake source root to the resolved deposit directory', () => {
    const config = loadComposedConfig({ ...withoutRoot, LIBRARY_ROOT: '/legacy' })._unsafeUnwrap();
    expect(config.intakeSourceRoot).toBe('/legacy');
  });
});

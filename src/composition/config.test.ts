import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const base = { LIBRARY_ROOT: '/library', STAGING_ROOT: '/staging' };

describe('loadConfig', () => {
  it('reads a fully-specified environment', () => {
    const config = loadConfig({
      ...base,
      HTTP_PORT: '8080',
      HTTP_HOST: '127.0.0.1',
      DATABASE_FILE: '/data/events.db',
      LOG_LEVEL: 'debug',
      MUSICBRAINZ_BASE_URL: 'https://mb.test',
      MUSICBRAINZ_USER_AGENT: 'md/1.0',
      SLSKD_BASE_URL: 'http://slskd:5030',
      SLSKD_API_KEY: 'secret',
    })._unsafeUnwrap();

    expect(config).toEqual({
      httpPort: 8080,
      host: '127.0.0.1',
      databaseFile: '/data/events.db',
      libraryRoot: '/library',
      stagingRoot: '/staging',
      logLevel: 'debug',
      musicbrainz: { baseUrl: 'https://mb.test', userAgent: 'md/1.0' },
      slskd: { baseUrl: 'http://slskd:5030', apiKey: 'secret' },
    });
  });

  it('applies defaults when optional vars are absent', () => {
    const config = loadConfig(base)._unsafeUnwrap();

    expect(config).toMatchObject({
      httpPort: 3000,
      host: '0.0.0.0',
      databaseFile: 'data/events.db',
      logLevel: 'info',
      musicbrainz: { baseUrl: undefined, userAgent: undefined },
      slskd: { baseUrl: undefined, apiKey: undefined },
    });
  });

  it('treats an empty optional var as absent', () => {
    const config = loadConfig({ ...base, SLSKD_API_KEY: '   ' })._unsafeUnwrap();

    expect(config.slskd.apiKey).toBeUndefined();
  });

  it('fails when a required var is missing', () => {
    expect(loadConfig({ STAGING_ROOT: '/staging' })._unsafeUnwrapErr()).toEqual({
      kind: 'MissingVar',
      name: 'LIBRARY_ROOT',
    });
  });

  it('fails when a required var is blank', () => {
    expect(loadConfig({ ...base, STAGING_ROOT: '' })._unsafeUnwrapErr()).toEqual({
      kind: 'MissingVar',
      name: 'STAGING_ROOT',
    });
  });

  it('fails when a numeric var is not a positive integer', () => {
    expect(loadConfig({ ...base, HTTP_PORT: 'abc' })._unsafeUnwrapErr()).toEqual({
      kind: 'InvalidNumber',
      name: 'HTTP_PORT',
      value: 'abc',
    });
    expect(loadConfig({ ...base, HTTP_PORT: '0' })._unsafeUnwrapErr()).toMatchObject({
      kind: 'InvalidNumber',
      value: '0',
    });
  });

  describe('webhooks (config-dormant)', () => {
    const SECRET = 'whsec_dGVzdC1zaWduaW5nLWtleQ==';

    it('is absent when WEBHOOK_URLS is unset — the publisher stays dormant', () => {
      expect(loadConfig(base)._unsafeUnwrap().webhooks).toBeUndefined();
    });

    it('is absent when WEBHOOK_URLS holds no usable url', () => {
      const config = loadConfig({ ...base, WEBHOOK_URLS: ' , ', WEBHOOK_SECRET: SECRET });
      expect(config._unsafeUnwrap().webhooks).toBeUndefined();
    });

    it('parses a comma-separated url list with its signing secret', () => {
      const config = loadConfig({
        ...base,
        WEBHOOK_URLS: 'https://a.example/hook, https://b.example/hook',
        WEBHOOK_SECRET: SECRET,
      })._unsafeUnwrap();
      expect(config.webhooks).toEqual({
        urls: ['https://a.example/hook', 'https://b.example/hook'],
        secret: SECRET,
      });
    });

    it('fails loudly on subscriber urls without a signing secret (unsigned publishing is impossible)', () => {
      const error = loadConfig({
        ...base,
        WEBHOOK_URLS: 'https://a.example/hook',
      })._unsafeUnwrapErr();
      expect(error).toEqual({ kind: 'MissingVar', name: 'WEBHOOK_SECRET' });
    });

    it('fails on a malformed secret (must be whsec_<base64>)', () => {
      const error = loadConfig({
        ...base,
        WEBHOOK_URLS: 'https://a.example/hook',
        WEBHOOK_SECRET: 'not a secret!',
      })._unsafeUnwrapErr();
      expect(error).toEqual({ kind: 'InvalidWebhookSecret' });
    });

    it('fails on an unparseable subscriber url', () => {
      const error = loadConfig({
        ...base,
        WEBHOOK_URLS: 'not-a-url',
        WEBHOOK_SECRET: SECRET,
      })._unsafeUnwrapErr();
      expect(error).toEqual({ kind: 'InvalidWebhookUrl', value: 'not-a-url' });
    });
  });
});

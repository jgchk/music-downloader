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
      expect(error).toEqual({ kind: 'InvalidWebhookSecret', name: 'WEBHOOK_SECRET' });
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

  describe('the verdict webhook receiver (config-dormant)', () => {
    const SECRET = 'whsec_cmVjZWl2ZXIta2V5';

    it('is absent when VERDICT_WEBHOOK_SECRET is unset — the endpoint stays dormant', () => {
      expect(loadConfig(base)._unsafeUnwrap().verdictWebhook).toBeUndefined();
    });

    it('treats a blank secret as absent', () => {
      const config = loadConfig({ ...base, VERDICT_WEBHOOK_SECRET: '   ' })._unsafeUnwrap();
      expect(config.verdictWebhook).toBeUndefined();
    });

    it('parses a well-formed receiver secret', () => {
      const config = loadConfig({ ...base, VERDICT_WEBHOOK_SECRET: SECRET })._unsafeUnwrap();
      expect(config.verdictWebhook).toEqual({ secret: SECRET });
    });

    it('fails on a malformed receiver secret (must be whsec_<base64>)', () => {
      const error = loadConfig({
        ...base,
        VERDICT_WEBHOOK_SECRET: 'nope',
      })._unsafeUnwrapErr();
      expect(error).toEqual({ kind: 'InvalidWebhookSecret', name: 'VERDICT_WEBHOOK_SECRET' });
    });
  });

  describe('the OAuth resource server (config-dormant)', () => {
    const ISSUER = 'https://auth.jake.cafe/realms/homelab';
    const RESOURCE = 'https://music-dl.jake.cafe/mcp';

    it('is absent when OAUTH_ISSUER is unset — the MCP endpoint stays open', () => {
      expect(loadConfig(base)._unsafeUnwrap().oauth).toBeUndefined();
    });

    it('treats a blank issuer as absent', () => {
      const config = loadConfig({ ...base, OAUTH_ISSUER: '   ' })._unsafeUnwrap();
      expect(config.oauth).toBeUndefined();
    });

    it('parses issuer + resource, deriving JWKS from discovery by default', () => {
      const config = loadConfig({
        ...base,
        OAUTH_ISSUER: ISSUER,
        OAUTH_RESOURCE: RESOURCE,
      })._unsafeUnwrap();
      expect(config.oauth).toEqual({ issuer: ISSUER, resource: RESOURCE, jwksUri: undefined });
    });

    it('carries an explicit JWKS URI when provided', () => {
      const JWKS = 'https://auth.jake.cafe/realms/homelab/protocol/openid-connect/certs';
      const config = loadConfig({
        ...base,
        OAUTH_ISSUER: ISSUER,
        OAUTH_RESOURCE: RESOURCE,
        OAUTH_JWKS_URI: JWKS,
      })._unsafeUnwrap();
      expect(config.oauth).toEqual({ issuer: ISSUER, resource: RESOURCE, jwksUri: JWKS });
    });

    it('fails loudly when the issuer is set without a resource (audience checking is mandatory)', () => {
      const error = loadConfig({ ...base, OAUTH_ISSUER: ISSUER })._unsafeUnwrapErr();
      expect(error).toEqual({ kind: 'MissingVar', name: 'OAUTH_RESOURCE' });
    });

    it('fails on an unparseable issuer URL', () => {
      const error = loadConfig({
        ...base,
        OAUTH_ISSUER: 'not-a-url',
        OAUTH_RESOURCE: RESOURCE,
      })._unsafeUnwrapErr();
      expect(error).toEqual({ kind: 'InvalidOAuthUrl', name: 'OAUTH_ISSUER', value: 'not-a-url' });
    });

    it('fails on an unparseable resource URL', () => {
      const error = loadConfig({
        ...base,
        OAUTH_ISSUER: ISSUER,
        OAUTH_RESOURCE: 'not-a-url',
      })._unsafeUnwrapErr();
      expect(error).toEqual({
        kind: 'InvalidOAuthUrl',
        name: 'OAUTH_RESOURCE',
        value: 'not-a-url',
      });
    });

    it('fails on an unparseable explicit JWKS URI', () => {
      const error = loadConfig({
        ...base,
        OAUTH_ISSUER: ISSUER,
        OAUTH_RESOURCE: RESOURCE,
        OAUTH_JWKS_URI: 'not-a-url',
      })._unsafeUnwrapErr();
      expect(error).toEqual({
        kind: 'InvalidOAuthUrl',
        name: 'OAUTH_JWKS_URI',
        value: 'not-a-url',
      });
    });
  });
});

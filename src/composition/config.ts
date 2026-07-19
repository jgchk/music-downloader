import { Result, err, ok } from 'neverthrow';

/**
 * 12-factor configuration (D14): the entire config surface is read from the environment and
 * validated once, failing fast with a typed error rather than surfacing a half-configured app at
 * runtime. Secrets (the slskd API key) come from the environment and never from source. This module
 * is pure — the composition root turns a `ConfigError` into a fatal startup fault.
 */

export interface AppConfig {
  readonly httpPort: number;
  readonly host: string;
  readonly databaseFile: string;
  readonly libraryRoot: string;
  readonly stagingRoot: string;
  readonly logLevel: string;
  readonly musicbrainz: { readonly baseUrl?: string; readonly userAgent?: string };
  readonly slskd: { readonly baseUrl?: string; readonly apiKey?: string };
  /**
   * Outbound webhook publishing (change: acquisition-outbound-events). Present only when
   * `WEBHOOK_URLS` names at least one subscriber — absent, the publisher never starts and the tool
   * behaves exactly as before (config-dormant). URLs configured without `WEBHOOK_SECRET` are a
   * startup failure: publishing unsigned is impossible.
   */
  readonly webhooks?: { readonly urls: readonly string[]; readonly secret: string };
}

export type ConfigError =
  | { readonly kind: 'MissingVar'; readonly name: string }
  | { readonly kind: 'InvalidNumber'; readonly name: string; readonly value: string }
  | { readonly kind: 'InvalidWebhookUrl'; readonly value: string }
  | { readonly kind: 'InvalidWebhookSecret' }; // never echoes the secret

type Env = Record<string, string | undefined>;

function requireVar(env: Env, name: string): Result<string, ConfigError> {
  const value = env[name];
  return value !== undefined && value.trim() !== '' ? ok(value) : err({ kind: 'MissingVar', name });
}

function numberVar(env: Env, name: string, fallback: number): Result<number, ConfigError> {
  const raw = env[name];
  if (raw === undefined) return ok(fallback);
  const value = Number(raw);
  return Number.isInteger(value) && value > 0
    ? ok(value)
    : err({ kind: 'InvalidNumber', name, value: raw });
}

function optional(env: Env, name: string): string | undefined {
  const value = env[name];
  return value !== undefined && value.trim() !== '' ? value : undefined;
}

/** `whsec_` + base64 — the Standard Webhooks signing-secret format. */
const WEBHOOK_SECRET_PATTERN = /^whsec_[A-Za-z0-9+/]+={0,2}$/;

function webhooksVar(env: Env): Result<AppConfig['webhooks'], ConfigError> {
  const raw = optional(env, 'WEBHOOK_URLS');
  const urls = (raw ?? '')
    .split(',')
    .map((url) => url.trim())
    .filter((url) => url !== '');
  if (urls.length === 0) return ok(undefined); // dormant: no subscribers, no publisher
  const invalid = urls.find((url) => !URL.canParse(url));
  if (invalid !== undefined) return err({ kind: 'InvalidWebhookUrl', value: invalid });
  const secret = optional(env, 'WEBHOOK_SECRET');
  if (secret === undefined) return err({ kind: 'MissingVar', name: 'WEBHOOK_SECRET' });
  if (!WEBHOOK_SECRET_PATTERN.test(secret)) return err({ kind: 'InvalidWebhookSecret' });
  return ok({ urls, secret });
}

export function loadConfig(env: Env): Result<AppConfig, ConfigError> {
  return Result.combine([
    requireVar(env, 'LIBRARY_ROOT'),
    requireVar(env, 'STAGING_ROOT'),
    numberVar(env, 'HTTP_PORT', 3000),
    webhooksVar(env),
  ]).map(([libraryRoot, stagingRoot, httpPort, webhooks]) => ({
    httpPort,
    host: optional(env, 'HTTP_HOST') ?? '0.0.0.0',
    databaseFile: optional(env, 'DATABASE_FILE') ?? 'data/events.db',
    libraryRoot,
    stagingRoot,
    logLevel: optional(env, 'LOG_LEVEL') ?? 'info',
    musicbrainz: {
      baseUrl: optional(env, 'MUSICBRAINZ_BASE_URL'),
      userAgent: optional(env, 'MUSICBRAINZ_USER_AGENT'),
    },
    slskd: {
      baseUrl: optional(env, 'SLSKD_BASE_URL'),
      apiKey: optional(env, 'SLSKD_API_KEY'),
    },
    webhooks,
  }));
}

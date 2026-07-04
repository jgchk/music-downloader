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
}

export type ConfigError =
  | { readonly kind: 'MissingVar'; readonly name: string }
  | { readonly kind: 'InvalidNumber'; readonly name: string; readonly value: string };

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

export function loadConfig(env: Env): Result<AppConfig, ConfigError> {
  return Result.combine([
    requireVar(env, 'LIBRARY_ROOT'),
    requireVar(env, 'STAGING_ROOT'),
    numberVar(env, 'HTTP_PORT', 3000),
  ]).map(([libraryRoot, stagingRoot, httpPort]) => ({
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
  }));
}

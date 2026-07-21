import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';
import type { DownloaderRuntimeConfig } from '@music/downloader/runtime';
import type { ImporterRuntimeConfig } from '@music/importer/runtime';

/**
 * The composed process's ONE environment configuration surface (runtime-baseline): both modules
 * and the web interface, validated once at startup with errors naming the offending setting.
 * Webhook-era settings do not exist here — an environment still carrying them is inert. The two
 * event-store files are separate per module (never one file, never ATTACHed). PORT/HOST are read
 * by adapter-node itself; LOG_LEVEL by the logger; everything else feeds the module runtimes.
 */

const envSchema = z.object({
  LOG_LEVEL: z.string().min(1).default('info'),

  // --- downloader ------------------------------------------------------------------------------
  DOWNLOADER_DATABASE_FILE: z.string().min(1).default('data/downloader/events.db'),
  LIBRARY_ROOT: z.string().min(1),
  STAGING_ROOT: z.string().min(1),
  SLSKD_BASE_URL: z.string().min(1).optional(),
  SLSKD_API_KEY: z.string().min(1).optional(),
  MUSICBRAINZ_BASE_URL: z.string().min(1).optional(),
  MUSICBRAINZ_USER_AGENT: z.string().min(1).optional(),

  // --- importer --------------------------------------------------------------------------------
  IMPORTER_DATABASE_FILE: z.string().min(1).default('data/importer/events.db'),
  INTAKE_ROOT: z.string().min(1),
  BEETS_CONFIG: z.string().min(1),
  BRIDGE_PYTHON: z.string().min(1).default('python3'),
  BRIDGE_TIMEOUT_MS: z.coerce.number().int().positive().default(600_000),
  AUTO_APPLY_THRESHOLD: z.coerce.number().min(0).max(1).default(0.04),
  /**
   * The namespace root the downloader's delivered locations fall under, re-rooted onto
   * INTAKE_ROOT at intake (design D11). In the composed process the sender IS the local
   * downloader, so this defaults to STAGING_ROOT.
   */
  INTAKE_SOURCE_ROOT: z.string().min(1).optional(),
});

export interface ComposedConfig {
  readonly logLevel: string;
  readonly downloader: DownloaderRuntimeConfig;
  readonly importer: ImporterRuntimeConfig;
  readonly intakeSourceRoot: string;
}

export function loadComposedConfig(
  env: Record<string, string | undefined>,
): Result<ComposedConfig, string> {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    return err(`invalid configuration — ${detail}`);
  }
  const v = parsed.data;
  return ok({
    logLevel: v.LOG_LEVEL,
    downloader: {
      databaseFile: v.DOWNLOADER_DATABASE_FILE,
      libraryRoot: v.LIBRARY_ROOT,
      stagingRoot: v.STAGING_ROOT,
      musicbrainz: { baseUrl: v.MUSICBRAINZ_BASE_URL, userAgent: v.MUSICBRAINZ_USER_AGENT },
      slskd: { baseUrl: v.SLSKD_BASE_URL, apiKey: v.SLSKD_API_KEY },
    },
    importer: {
      databaseFile: v.IMPORTER_DATABASE_FILE,
      intakeRoot: v.INTAKE_ROOT,
      beetsConfigPath: v.BEETS_CONFIG,
      bridgePython: v.BRIDGE_PYTHON,
      bridgeTimeoutMs: v.BRIDGE_TIMEOUT_MS,
      autoApplyThreshold: v.AUTO_APPLY_THRESHOLD,
    },
    intakeSourceRoot: v.INTAKE_SOURCE_ROOT ?? v.STAGING_ROOT,
  });
}

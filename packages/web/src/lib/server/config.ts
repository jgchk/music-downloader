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

const environmentSchema = z.object({
  LOG_LEVEL: z.string().min(1).default('info'),

  // --- downloader ------------------------------------------------------------------------------
  DOWNLOADER_DATABASE_FILE: z.string().min(1).default('data/downloader/events.db'),
  /**
   * Where the downloader deposits a fulfilled release for the importer to pick up. `LIBRARY_ROOT`
   * is the same setting under its former name — a fossil from when this module placed files in the
   * library itself, which it never does now (beets does). Either name works; they may not disagree.
   */
  DEPOSIT_ROOT: z.string().min(1).optional(),
  LIBRARY_ROOT: z.string().min(1).optional(),
  STAGING_ROOT: z.string().min(1),
  SLSKD_BASE_URL: z.string().min(1).optional(),
  SLSKD_API_KEY: z.string().min(1).optional(),
  MUSICBRAINZ_BASE_URL: z.string().min(1).optional(),
  MUSICBRAINZ_USER_AGENT: z.string().min(1).optional(),
  // Parked-effect retry tuning (reactor-durability D2); unset falls back to runtime defaults
  // (5s initial, 15min cap, 6h wall-clock budget, 30d stalled retention).
  REACTOR_RETRY_INITIAL_DELAY_MS: z.coerce.number().int().positive().optional(),
  REACTOR_RETRY_MAX_DELAY_MS: z.coerce.number().int().positive().optional(),
  REACTOR_RETRY_BUDGET_MS: z.coerce.number().int().nonnegative().optional(),
  REACTOR_STALLED_RETENTION_MS: z.coerce.number().int().positive().optional(),
  /** Per-file kill budget for the ffprobe/decode passes — a hung run must never wedge dispatch. */
  FFMPEG_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),

  // --- importer --------------------------------------------------------------------------------
  IMPORTER_DATABASE_FILE: z.string().min(1).default('data/importer/events.db'),
  INTAKE_ROOT: z.string().min(1),
  BEETS_CONFIG: z.string().min(1),
  BRIDGE_PYTHON: z.string().min(1).default('python3'),
  /**
   * Where bridge.py lives. The importer's packaged default resolves beside its own module, which
   * a bundling deployment (the SvelteKit server build) relocates — deployments set this
   * explicitly; the Docker image points it at the copied script.
   */
  BRIDGE_SCRIPT: z.string().min(1).optional(),
  BRIDGE_TIMEOUT_MS: z.coerce.number().int().positive().default(600_000),
  AUTO_APPLY_THRESHOLD: z.coerce.number().min(0).max(1).default(0.04),
  /**
   * The namespace root the downloader's delivered locations fall under, re-rooted onto
   * INTAKE_ROOT at intake (design D11). `acquisition.fulfilled` carries the DEPOSITED location —
   * a directory under the downloader's LIBRARY_ROOT — so that is the default source namespace
   * (a STAGING_ROOT default would reject every delivery as outside the source root).
   */
  INTAKE_SOURCE_ROOT: z.string().min(1).optional(),

  // --- web access control (add-plex-auth-gate) -------------------------------------------------
  // Both gate settings are REQUIRED: a process without them must fail startup, never serve with a
  // weakened or open gate (web-access-control: misconfiguration fails closed).
  /** Signs session cookies; rotating it is the everyone-out-now revocation lever (design D4).
   * The 32-char floor is part of fail-closed: a brute-forceable HMAC secret IS a misconfiguration,
   * and it must fail startup, not serve a weakened gate. */
  SESSION_SECRET: z.string().min(32),
  /** The owner's Plex server `machineIdentifier` — membership in it IS approval (design D2/D5). */
  PLEX_SERVER_MACHINE_ID: z.string().min(1),
  /** plex.tv API base; overridden only by test tiers pointing at stubs (design D7). */
  PLEX_API_BASE_URL: z.string().min(1).default('https://plex.tv/api/v2'),
});

/** The web interface's access-control settings (web-access-control capability). */
export interface AccessConfig {
  readonly sessionSecret: string;
  readonly plex: {
    readonly machineId: string;
    readonly baseUrl: string;
  };
}

export interface ComposedConfig {
  readonly logLevel: string;
  /** Deprecations and the like, surfaced once the logger this config builds exists. */
  readonly warnings: readonly string[];
  readonly downloader: DownloaderRuntimeConfig;
  readonly importer: ImporterRuntimeConfig;
  readonly intakeSourceRoot: string;
  readonly access: AccessConfig;
}

export function loadComposedConfig(
  environment: Record<string, string | undefined>,
): Result<ComposedConfig, string> {
  const parsed = environmentSchema.safeParse(environment);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    return err(`invalid configuration — ${detail}`);
  }
  const v = parsed.data;

  const depositRoot = v.DEPOSIT_ROOT ?? v.LIBRARY_ROOT;
  if (depositRoot === undefined) {
    return err('invalid configuration — DEPOSIT_ROOT: required');
  }
  if (v.DEPOSIT_ROOT !== undefined && v.LIBRARY_ROOT !== undefined && v.DEPOSIT_ROOT !== v.LIBRARY_ROOT) {
    return err(
      'invalid configuration — DEPOSIT_ROOT and LIBRARY_ROOT are both set to different paths; ' +
        'remove LIBRARY_ROOT, which is the former name of the same setting',
    );
  }
  // Reported rather than logged: this function is pure, and the logger does not exist until the
  // configuration it is built from has parsed.
  const warnings =
    v.DEPOSIT_ROOT === undefined && v.LIBRARY_ROOT !== undefined
      ? ['LIBRARY_ROOT is the former name of DEPOSIT_ROOT; set DEPOSIT_ROOT instead']
      : [];

  return ok({
    warnings,
    logLevel: v.LOG_LEVEL,
    downloader: {
      databaseFile: v.DOWNLOADER_DATABASE_FILE,
      depositRoot,
      stagingRoot: v.STAGING_ROOT,
      musicbrainz: { baseUrl: v.MUSICBRAINZ_BASE_URL, userAgent: v.MUSICBRAINZ_USER_AGENT },
      slskd: { baseUrl: v.SLSKD_BASE_URL, apiKey: v.SLSKD_API_KEY },
      ffmpeg: { timeoutMs: v.FFMPEG_TIMEOUT_MS },
      reactor: {
        retry: {
          ...(v.REACTOR_RETRY_INITIAL_DELAY_MS !== undefined && {
            initialDelayMs: v.REACTOR_RETRY_INITIAL_DELAY_MS,
          }),
          ...(v.REACTOR_RETRY_MAX_DELAY_MS !== undefined && {
            maxDelayMs: v.REACTOR_RETRY_MAX_DELAY_MS,
          }),
          ...(v.REACTOR_RETRY_BUDGET_MS !== undefined && { budgetMs: v.REACTOR_RETRY_BUDGET_MS }),
        },
        stalledRetentionMs: v.REACTOR_STALLED_RETENTION_MS,
      },
    },
    importer: {
      databaseFile: v.IMPORTER_DATABASE_FILE,
      intakeRoot: v.INTAKE_ROOT,
      beetsConfigPath: v.BEETS_CONFIG,
      bridgePython: v.BRIDGE_PYTHON,
      bridgeTimeoutMs: v.BRIDGE_TIMEOUT_MS,
      bridgeScript: v.BRIDGE_SCRIPT,
      autoApplyThreshold: v.AUTO_APPLY_THRESHOLD,
    },
    intakeSourceRoot: v.INTAKE_SOURCE_ROOT ?? depositRoot,
    access: {
      sessionSecret: v.SESSION_SECRET,
      plex: { machineId: v.PLEX_SERVER_MACHINE_ID, baseUrl: v.PLEX_API_BASE_URL },
    },
  });
}

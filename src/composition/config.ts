import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { z } from 'zod';

/**
 * Environment-derived configuration (12-factor): the composition root's testable seam. All config
 * comes from the environment; validation happens once, at startup, and a bad environment aborts
 * boot with a precise error rather than failing later at first use.
 */

const envSchema = z.object({
  HTTP_PORT: z.coerce.number().int().positive().default(3000),
});

export interface AppConfig {
  readonly httpPort: number;
}

export function loadConfig(env: NodeJS.ProcessEnv): Result<AppConfig, string> {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) return err(parsed.error.message);
  return ok({ httpPort: parsed.data.HTTP_PORT });
}

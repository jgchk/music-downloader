import type { Logger } from 'pino';
import type { Facades } from '$lib/server/runtime.js';

// See https://svelte.dev/docs/kit/types#app.d.ts for information about these interfaces.
declare global {
  namespace App {
    interface Locals {
      /** The module facades, wired by the init/handle hooks — the only module surface routes see. */
      facades: Facades;
      /** The composed process's structured logger, for request-scoped diagnostics. */
      logger: Logger;
    }
  }
}

export {};

import type { Logger } from 'pino';
import type { Access, Facades } from '$lib/server/runtime.js';
import type { SessionClaims } from '$lib/server/session.js';

// See https://svelte.dev/docs/kit/types#app.d.ts for information about these interfaces.
declare global {
  namespace App {
    interface Error {
      /** SvelteKit's error shape, plus the id `handleError` mints so a user can quote a fault. */
      message: string;
      errorId?: string;
    }
    interface Locals {
      /** The module facades, wired by the init/handle hooks — the only module surface routes see. */
      facades: Facades;
      /** The composed process's structured logger, for request-scoped diagnostics. */
      logger: Logger;
      /** The wall clock, injected here (the one impure edge) so loads stay clock-testable. */
      now: () => string;
      /** The access-control composition (session secret + PlexAccess port) for the login flow. */
      access: Access;
      /**
       * The verified session's claims, set by the gate when the request carries a valid cookie.
       * Undefined on the open routes (login flow, health) when no valid session rides along.
       */
      session?: SessionClaims;
    }
  }
}

export {};

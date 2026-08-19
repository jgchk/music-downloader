import type { Logger } from 'pino';
import type { Access, Facades } from '$lib/server/runtime.js';
import type { CoverArtPort } from '$lib/server/cover-art/port.js';
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
      /**
       * The request's structured logger, already bound to {@link Locals.correlationId} — use it
       * for every server-side line so the request's diagnostics stay joinable.
       */
      logger: Logger;
      /**
       * The story this request opened (operation-correlation): minted once by the `handle` hook,
       * passed to every facade COMMAND so the modules' events and logs carry it too. Never shown
       * to a user — it is a diagnostic identity, not interface copy.
       */
      correlationId: string;
      /** The wall clock, injected here (the one impure edge) so loads stay clock-testable. */
      now: () => string;
      /** The access-control composition (session secret + PlexAccess port) for the login flow. */
      access: Access;
      /** The cached cover-art port, read by the artwork endpoint the request page's images use. */
      coverArt: CoverArtPort;
      /**
       * The verified session's claims, set by the gate when the request carries a valid cookie.
       * Undefined on the open routes (login flow, health) when no valid session rides along.
       */
      session?: SessionClaims;
    }
  }
}

export {};

import { z } from 'zod';

/**
 * The consumed plex.tv surface (external-api-contracts): tolerant zod schemas declaring ONLY the
 * fields the login flow reads, enforced at the adapter's HTTP boundary. These are the single
 * source of truth the contract tier records and replays against — adapter types derive from them.
 */

/** POST /pins — a fresh PIN to hand to Plex's hosted auth page. */
export const plexPinCreateSchema = z.object({
  id: z.number(),
  code: z.string(),
});
export type PlexPinCreate = z.infer<typeof plexPinCreateSchema>;

/** GET /pins/{id} — the poll-once check; `authToken` stays null until the user approves. */
export const plexPinCheckSchema = z.object({
  id: z.number(),
  authToken: z.string().nullish(),
});
export type PlexPinCheck = z.infer<typeof plexPinCheckSchema>;

/** GET /user — who the token belongs to. `title` covers accounts with no username. */
export const plexUserSchema = z.object({
  id: z.number(),
  username: z.string().nullish(),
  title: z.string().nullish(),
});
export type PlexUser = z.infer<typeof plexUserSchema>;

/**
 * GET /resources — every device the account can see. Membership requires a machine-id match on an
 * entry that DECLARES a server, and the admitting entries' `owned` flags are the session's role
 * source (owner iff any is owned). Both fields are self-asserted by the resource, exactly as the
 * identifier is (see
 * `docs/research/plex-machine-identifier-trust.md`) — reading them narrows admission, it does not
 * authenticate the server. Both are optional: tolerance degrades toward denial/guest, never
 * toward grant. Their TYPES stay strict, so a plex.tv type change fails the parse loudly (a
 * fail-closed outage) rather than coercing into a silent grant.
 */
export const plexResourcesSchema = z.array(
  z.object({
    clientIdentifier: z.string(),
    /** Comma-separated capability list (e.g. `"server"`, `"client,player,pubsub-player"`). */
    provides: z.string().optional(),
    /** True when the account owns this resource (vs sees it via a share). */
    owned: z.boolean().optional(),
  }),
);
export type PlexResources = z.infer<typeof plexResourcesSchema>;

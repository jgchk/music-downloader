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

/** GET /resources — every device the account can see; membership is a machine-id match. */
export const plexResourcesSchema = z.array(z.object({ clientIdentifier: z.string() }));
export type PlexResources = z.infer<typeof plexResourcesSchema>;

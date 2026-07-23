import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { branded } from './brand.js';
import type { Brand } from './brand.js';

/**
 * A MusicBrainz identifier: a well-formed UUID, parsed once at the edge so the domain only ever
 * holds ids it can trust. Branded (compile-time only, runtime-erased) so a raw `string` cannot be
 * passed where an mbid is expected; the value serializes on events as a plain string unchanged.
 */
export type Mbid = Brand<string, 'Mbid'>;

export type InvalidMbid = { readonly kind: 'InvalidMbid'; readonly value: string };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Parse-don't-validate: a UUID-shaped string becomes an {@link Mbid}, anything else an error value. */
export function parseMbid(value: string): Result<Mbid, InvalidMbid> {
  const canonical = value.trim().toLowerCase();
  if (!UUID_PATTERN.test(canonical)) return err({ kind: 'InvalidMbid', value });
  return ok(branded<Mbid>(canonical));
}

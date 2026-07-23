import { branded } from '../brand.js';
import type { Mbid } from '../mbid.js';

/**
 * Brand an arbitrary string as an {@link Mbid} for tests. UUID well-formedness is an edge concern
 * (the facade/adapter parse it with `parseMbid`); the domain only needs *some* mbid, so tests mint
 * one directly without threading a valid UUID through every fixture.
 */
export function asMbid(value: string): Mbid {
  return branded<Mbid>(value);
}

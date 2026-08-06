import { branded } from '../brand.js';
import type { Mbid } from '../mbid.js';

/**
 * Brand an arbitrary string as an {@link Mbid} for SYNTHETIC test data. UUID well-formedness is an
 * edge concern (the facade/adapter parse it with `parseMbid`); the domain only needs *some* mbid, so
 * tests mint one directly without threading a valid UUID through every fixture.
 *
 * Not blanket permission: this is legitimate only for a value the test itself authored. An mbid that
 * comes from OUTSIDE the test — recorded provider bytes, a frozen fixture replayed back through an
 * adapter, a live response — must go through `parseMbid`, because there the brand is a claim about
 * data the test did not write, and a cast would bless whatever the recording happens to contain
 * (see `recordedMbid` in test/contract/musicbrainz.contract.test.ts for the parsing form).
 */
export function asMbid(value: string): Mbid {
  return branded<Mbid>(value);
}

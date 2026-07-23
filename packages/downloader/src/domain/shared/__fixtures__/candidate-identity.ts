import { branded } from '../brand.js';
import type { CandidateIdentity, CandidateIdentityInput } from '../../candidate/candidate.js';

/**
 * Brand a raw identity shape as a {@link CandidateIdentity} for tests. Well-formedness is an edge
 * concern (the slskd adapter parses it with `parseCandidateIdentity`); domain tests just need *some*
 * identity, so they mint one directly without threading a parse Result through every fixture.
 */
export function asCandidateIdentity(input: CandidateIdentityInput): CandidateIdentity {
  return branded<CandidateIdentity>(input);
}

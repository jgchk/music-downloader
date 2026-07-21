import type { Candidate, CandidateFile, SourceReliability } from '../candidate/candidate.js';
import { candidateKey } from '../candidate/candidate.js';
import { audioFiles, scoreMatch } from '../matching/match-scorer.js';
import type { MatchPolicy } from '../policy/policies.js';
import {
  bucketRank,
  compareQuality,
  meetsFloor,
  resolveQualityBucket,
} from '../policy/quality-policy.js';
import type { QualityAttributes, QualityBucket, QualityPolicy } from '../policy/quality-policy.js';
import type { Target } from '../target/target.js';

/**
 * Lexicographic candidate ranking (D11): match is a *gate*, quality is the optimization.
 * A pristine wrong-album FLAC must never win. Deterministic and pure — lives in `decide`.
 */
export interface RankedCandidate {
  readonly candidate: Candidate;
  readonly matchConfidence: number;
  readonly qualityBucket: QualityBucket;
}

function fileAttributes(file: CandidateFile): QualityAttributes {
  return {
    codec: file.codec ?? '',
    bitrate: file.bitrate,
    sampleRate: file.sampleRate,
    bitDepth: file.bitDepth,
  };
}

/** A release is only as good as its worst track: take the lowest-quality audio file's bucket. */
export function candidateQualityBucket(candidate: Candidate, policy: QualityPolicy): QualityBucket {
  const buckets = audioFiles(candidate).map((file) => resolveQualityBucket(fileAttributes(file)));
  if (buckets.length === 0) return 'UNKNOWN';
  return buckets.reduce((worst, bucket) =>
    bucketRank(policy, bucket) > bucketRank(policy, worst) ? bucket : worst,
  );
}

/** Prefer the source likeliest to deliver: faster, more free slots, shorter queue. */
function compareSource(a: SourceReliability, b: SourceReliability): number {
  if (a.speedBytesPerSec !== b.speedBytesPerSec) return b.speedBytesPerSec - a.speedBytesPerSec;
  if (a.freeSlots !== b.freeSlots) return b.freeSlots - a.freeSlots;
  return a.queueLength - b.queueLength;
}

/**
 * Score, gate, and order candidates. The gate keeps only candidates at/above the match threshold
 * and the quality floor; survivors sort by quality bucket, then match confidence, then source
 * reliability, with a stable identity tie-break for full determinism.
 */
export function rankCandidates(
  candidates: readonly Candidate[],
  target: Target,
  quality: QualityPolicy,
  match: MatchPolicy,
): readonly RankedCandidate[] {
  const scored: RankedCandidate[] = candidates.map((candidate) => ({
    candidate,
    matchConfidence: scoreMatch(target, candidate),
    qualityBucket: candidateQualityBucket(candidate, quality),
  }));

  const gated = scored.filter(
    (ranked) =>
      ranked.matchConfidence >= match.threshold && meetsFloor(quality, ranked.qualityBucket),
  );

  return gated.sort((x, y) => {
    const byQuality = compareQuality(quality, x.qualityBucket, y.qualityBucket);
    if (byQuality !== 0) return byQuality;
    if (x.matchConfidence !== y.matchConfidence) return y.matchConfidence - x.matchConfidence;
    const bySource = compareSource(x.candidate.source, y.candidate.source);
    if (bySource !== 0) return bySource;
    return candidateKey(x.candidate.identity).localeCompare(candidateKey(y.candidate.identity));
  });
}

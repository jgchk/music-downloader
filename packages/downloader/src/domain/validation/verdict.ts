import type { MatchPolicy } from '../policy/policies.js';
import { clampUnit } from '../shared/unit.js';
import type { Unit } from '../shared/unit.js';

/**
 * The composable validation verdict (D5). Validators each produce an outcome; the pipeline
 * combines them into one confidence + reasons that `decide` consumes without knowing which
 * checks ran. New validators can be added without touching the aggregate (OCP).
 */
export type ValidationReason =
  | 'Unplayable'
  | 'WrongTrackCount'
  | 'DurationMismatch'
  | 'RecordingMismatch' // fingerprint tier — seam only
  | 'QualityNotAuthentic'; // transcode tier — seam only

export interface ValidationVerdict {
  readonly confidence: Unit;
  readonly reasons: readonly ValidationReason[];
}

export interface ValidatorOutcome {
  readonly name: string;
  readonly score: Unit; // this validator's confidence in [0, 1]
  readonly reason?: ValidationReason; // present when the validator objects
}

/**
 * Combine validator outcomes by the weakest link: confidence is the minimum score (so a single
 * failed check — e.g. unplayable — collapses the verdict) and reasons are the union of objections.
 * This keeps validation monotonically stronger as validators are added. An empty pipeline cannot
 * vouch for anything, so it yields zero confidence.
 */
export function combineVerdict(outcomes: readonly ValidatorOutcome[]): ValidationVerdict {
  if (outcomes.length === 0) return { confidence: clampUnit(0), reasons: [] };
  const confidence = clampUnit(Math.min(...outcomes.map((outcome) => outcome.score)));
  const reasons = outcomes.flatMap((outcome) =>
    outcome.reason !== undefined ? [outcome.reason] : [],
  );
  return { confidence, reasons };
}

/** A download is valid only when the verdict clears the acquisition's match threshold (D5). */
export function verdictPasses(verdict: ValidationVerdict, policy: MatchPolicy): boolean {
  return verdict.confidence >= policy.threshold;
}

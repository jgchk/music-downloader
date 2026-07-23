import { ResultAsync } from 'neverthrow';
import type { DownloadedFile } from '../../domain/acquisition/events.js';
import type { MatchPolicy } from '../../domain/policy/policies.js';
import type { Target } from '../../domain/target/target.js';
import {
  playabilityValidator,
  structuralIdentityValidator,
} from '../../domain/validation/validators.js';
import { combineVerdict, isVerdictPassing } from '../../domain/validation/verdict.js';
import type { ValidationVerdict } from '../../domain/validation/verdict.js';
import type { InfraError } from '../ports/errors.js';
import type { AudioProbePort } from '../ports/outbound-ports.js';

/**
 * The validation service (D2/D5): probe every downloaded file (infra), then run the pure validator
 * pipeline over the probes to produce one verdict and a pass/fail against the match policy.
 */
export interface ValidationResult {
  readonly passed: boolean;
  readonly verdict: ValidationVerdict;
}

export function runValidation(
  probe: AudioProbePort,
  files: readonly DownloadedFile[],
  target: Target,
  matchPolicy: MatchPolicy,
): ResultAsync<ValidationResult, InfraError> {
  return ResultAsync.combine(files.map((file) => probe.probe(file.path))).map((probes) => {
    const verdict = combineVerdict([
      playabilityValidator(probes),
      structuralIdentityValidator(probes, target),
    ]);
    return { passed: isVerdictPassing(verdict, matchPolicy), verdict };
  });
}

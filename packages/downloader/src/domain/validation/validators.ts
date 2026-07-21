import { alignmentScore } from '../shared/duration.js';
import type { Target } from '../target/target.js';
import type { ValidatorOutcome } from './verdict.js';

/**
 * The result of inspecting one downloaded audio file's actual bytes. Produced by the
 * AudioProbePort (ffmpeg) in the shell; the validators below are pure functions over it (D5),
 * unit-tested with fabricated probes. A single decode yields both playability and ground-truth
 * duration, so the two MVP validators share one probe.
 */
export interface ProbedAudio {
  readonly decodedCleanly: boolean;
  readonly codec: string;
  readonly durationMs: number;
  readonly sampleRate?: number;
  readonly bitDepth?: number;
  readonly bitrate?: number;
  readonly channels?: number;
}

/** MVP validator 1 — playability: every file must fully decode (D5 axis 1). Codec-agnostic. */
export function playabilityValidator(probes: readonly ProbedAudio[]): ValidatorOutcome {
  const allPlayable = probes.length > 0 && probes.every((probe) => probe.decodedCleanly);
  return allPlayable
    ? { name: 'playability', score: 1 }
    : { name: 'playability', score: 0, reason: 'Unplayable' };
}

/** MVP validator 2 — structural identity: track count + decoded durations vs the target (D5 axis 2a). */
export function structuralIdentityValidator(
  probes: readonly ProbedAudio[],
  target: Target,
): ValidatorOutcome {
  if (probes.length !== target.tracks.length) {
    return { name: 'structuralIdentity', score: 0, reason: 'WrongTrackCount' };
  }
  const score = alignmentScore(
    target.tracks.map((track) => track.durationMs),
    probes.map((probe) => probe.durationMs),
  );
  return score >= 1
    ? { name: 'structuralIdentity', score: 1 }
    : { name: 'structuralIdentity', score, reason: 'DurationMismatch' };
}

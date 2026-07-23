import { describe, expect, it } from 'vitest';
import { combineVerdict, verdictPasses } from './verdict.js';
import type { ValidatorOutcome } from './verdict.js';
import { playabilityValidator, structuralIdentityValidator } from './validators.js';
import type { ProbedAudio } from './validators.js';
import { createMatchPolicy } from '../policy/policies.js';
import { createTarget } from '../target/target.js';
import type { Target } from '../target/target.js';
import { asUnit } from '../shared/__fixtures__/unit.js';

const target: Target = createTarget({
  type: 'album',
  artist: 'Massive Attack',
  title: 'Mezzanine',
  tracks: [
    { position: 1, title: 'Angel', durationMs: 380000 },
    { position: 2, title: 'Risingson', durationMs: 298000 },
  ],
})._unsafeUnwrap();

function probe(overrides: Partial<ProbedAudio> = {}): ProbedAudio {
  return { decodedCleanly: true, codec: 'flac', durationMs: 380000, ...overrides };
}

describe('playabilityValidator', () => {
  it('passes when every file decodes cleanly, regardless of codec', () => {
    const probes = [probe({ codec: 'mp3' }), probe({ codec: 'opus', durationMs: 298000 })];
    expect(playabilityValidator(probes)).toEqual({ name: 'playability', score: 1 });
  });

  it('fails a truncated (undecodable) file', () => {
    const probes = [probe(), probe({ decodedCleanly: false, durationMs: 298000 })];
    expect(playabilityValidator(probes).reason).toBe('Unplayable');
  });

  it('fails an empty probe set', () => {
    expect(playabilityValidator([]).reason).toBe('Unplayable');
  });
});

describe('structuralIdentityValidator', () => {
  it('passes when track count and durations align', () => {
    const probes = [probe({ durationMs: 380000 }), probe({ durationMs: 298000 })];
    expect(structuralIdentityValidator(probes, target)).toEqual({
      name: 'structuralIdentity',
      score: 1,
    });
  });

  it('fails a wrong track count', () => {
    expect(structuralIdentityValidator([probe()], target).reason).toBe('WrongTrackCount');
  });

  it('fails on a duration mismatch and reports the partial score', () => {
    const probes = [probe({ durationMs: 380000 }), probe({ durationMs: 120000 })];
    const outcome = structuralIdentityValidator(probes, target);
    expect(outcome.reason).toBe('DurationMismatch');
    expect(outcome.score).toBe(0.5);
  });
});

describe('combineVerdict', () => {
  it('takes the weakest link and unions the reasons', () => {
    const outcomes: ValidatorOutcome[] = [
      { name: 'playability', score: asUnit(1) },
      { name: 'structuralIdentity', score: asUnit(0.5), reason: 'DurationMismatch' },
    ];
    expect(combineVerdict(outcomes)).toEqual({ confidence: 0.5, reasons: ['DurationMismatch'] });
  });

  it('yields zero confidence for an empty pipeline', () => {
    expect(combineVerdict([])).toEqual({ confidence: 0, reasons: [] });
  });
});

describe('verdictPasses', () => {
  it('passes a lenient policy and rejects a strict one for the same verdict', () => {
    // One track aligns, one is far off → structural score 0.5 → verdict confidence 0.5.
    const probes = [probe({ durationMs: 380000 }), probe({ durationMs: 120000 })];
    const verdict = combineVerdict([
      playabilityValidator(probes),
      structuralIdentityValidator(probes, target),
    ]);
    expect(verdictPasses(verdict, createMatchPolicy(0.5)._unsafeUnwrap())).toBe(true);
    expect(verdictPasses(verdict, createMatchPolicy(0.95)._unsafeUnwrap())).toBe(false);
  });
});

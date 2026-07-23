import type { Candidate, CandidateFile } from '../candidate/candidate.js';
import type { Target } from '../target/target.js';
import { alignmentScore } from '../shared/duration.js';
import { clampUnit } from '../shared/unit.js';
import type { Unit } from '../shared/unit.js';
import { containmentScore, normalizeText, tokenize } from './text.js';

/**
 * Search-time matching (D11): an extensible weighted signal pipeline producing a match
 * confidence in [0, 1] against the normalized Target. Structural signals (track count, duration)
 * outweigh gameable name/title strings. A probabilistic guess that orders the walk — validation
 * (D5) is the authoritative confirmation. New signals can be added without touching consumers (OCP).
 */
export interface MatchSignal {
  readonly name: string;
  /** The signal's relative pull on the weighted mean, in [0, 1] (mint via `clampUnit`/`parseUnit`). */
  readonly weight: Unit;
  /** A score in [0, 1], or `null` when the signal cannot be evaluated for this candidate. */
  readonly score: (target: Target, candidate: Candidate) => Unit | null;
}

const AUDIO_EXTENSIONS: ReadonlySet<string> = new Set([
  'flac',
  'mp3',
  'm4a',
  'mp4',
  'aac',
  'ogg',
  'oga',
  'opus',
  'wav',
  'wave',
  'aiff',
  'aif',
  'ape',
  'wv',
  'alac',
]);

function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

export function isAudioFile(file: CandidateFile): boolean {
  return (
    file.codec !== undefined ||
    file.durationMs !== undefined ||
    AUDIO_EXTENSIONS.has(fileExtension(file.name))
  );
}

export function audioFiles(candidate: Candidate): readonly CandidateFile[] {
  return candidate.files.filter((item) => isAudioFile(item));
}

function basename(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts.at(-1)!;
}

/** All the searchable text a candidate exposes: its folder name plus its file names. */
export function candidateText(candidate: Candidate): string {
  const names = candidate.files.map((file) => file.name).join(' ');
  return normalizeText(`${basename(candidate.identity.path)} ${names}`);
}

const TRACK_COUNT_WEIGHT = clampUnit(0.35);
const DURATION_WEIGHT = clampUnit(0.35);
const TITLE_WEIGHT = clampUnit(0.15);
const ARTIST_WEIGHT = clampUnit(0.1);
const YEAR_WEIGHT = clampUnit(0.05);

export const trackCountSignal: MatchSignal = {
  name: 'trackCount',
  weight: TRACK_COUNT_WEIGHT,
  score: (target, candidate) => {
    const actual = audioFiles(candidate).length;
    const expected = target.tracks.length;
    return clampUnit(Math.max(0, 1 - Math.abs(actual - expected) / expected));
  },
};

export const durationSignal: MatchSignal = {
  name: 'duration',
  weight: DURATION_WEIGHT,
  score: (target, candidate) => {
    const durations = audioFiles(candidate)
      .map((file) => file.durationMs)
      .filter((duration): duration is number => duration !== undefined);
    if (durations.length === 0) return null;
    return clampUnit(
      alignmentScore(
        target.tracks.map((track) => track.durationMs),
        durations,
      ),
    );
  },
};

export const titleSignal: MatchSignal = {
  name: 'title',
  weight: TITLE_WEIGHT,
  score: (target, candidate) =>
    clampUnit(containmentScore(tokenize(target.title), tokenize(candidateText(candidate)))),
};

export const artistSignal: MatchSignal = {
  name: 'artist',
  weight: ARTIST_WEIGHT,
  score: (target, candidate) =>
    clampUnit(containmentScore(tokenize(target.artist), tokenize(candidateText(candidate)))),
};

export const yearSignal: MatchSignal = {
  name: 'year',
  weight: YEAR_WEIGHT,
  score: (target, candidate) => {
    if (target.year === undefined) return null;
    return clampUnit(candidateText(candidate).includes(String(target.year)) ? 1 : 0);
  },
};

export const DEFAULT_MATCH_SIGNALS: readonly MatchSignal[] = [
  trackCountSignal,
  durationSignal,
  titleSignal,
  artistSignal,
  yearSignal,
];

/** Weighted mean over the applicable signals; 0 when no signal applies. */
export function scoreMatch(
  target: Target,
  candidate: Candidate,
  signals: readonly MatchSignal[] = DEFAULT_MATCH_SIGNALS,
): Unit {
  let weighted = 0;
  let totalWeight = 0;
  for (const signal of signals) {
    const score = signal.score(target, candidate);
    if (score === null) continue;
    weighted += score * signal.weight;
    totalWeight += signal.weight;
  }
  return clampUnit(totalWeight === 0 ? 0 : weighted / totalWeight);
}

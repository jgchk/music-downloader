import { createTarget } from '../../domain/target/target.js';
import type { Target } from '../../domain/target/target.js';

/**
 * Pure mapping from MusicBrainz JSON to the normalized, source-agnostic {@link Target} (D11,
 * anti-corruption layer). Any release/recording that can't yield a valid target — no tracks,
 * missing durations, no artist — collapses to `undefined`, which the adapter reports as the
 * business outcome *unresolved* rather than an infrastructure fault. MusicBrainz `length` fields
 * are already in milliseconds.
 */

interface MbArtistCredit {
  readonly name?: string;
  readonly joinphrase?: string;
}
interface MbTrack {
  readonly position?: number;
  readonly title?: string;
  readonly length?: number;
  readonly recording?: { readonly title?: string; readonly length?: number };
}
interface MbRelease {
  readonly id?: string;
  readonly title?: string;
  readonly date?: string;
  readonly 'artist-credit'?: readonly MbArtistCredit[];
  readonly media?: readonly { readonly tracks?: readonly MbTrack[] }[];
}
interface MbRecording {
  readonly id?: string;
  readonly title?: string;
  readonly length?: number;
  readonly 'artist-credit'?: readonly MbArtistCredit[];
}

/** A scored search hit (`/release?query=…` or `/recording?query=…`). */
export interface ScoredEntry {
  readonly id?: string;
  readonly score?: number;
}

const HIGH_CONFIDENCE = 90; // MusicBrainz search scores run 0–100
const AMBIGUITY_MARGIN = 10; // a top hit within this of the runner-up is not a confident pick

function artistCreditName(credits: readonly MbArtistCredit[] | undefined): string {
  return (credits ?? [])
    .map((credit) => `${credit.name ?? ''}${credit.joinphrase ?? ''}`)
    .join('')
    .trim();
}

function parseYear(date: string | undefined): number | undefined {
  const year = Number(date?.slice(0, 4));
  return Number.isInteger(year) && year > 0 ? year : undefined;
}

export function releaseToTarget(json: unknown): Target | undefined {
  const release = json as MbRelease;
  const tracks = (release.media ?? []).flatMap((medium) =>
    (medium.tracks ?? []).map((track, index) => ({
      position: track.position ?? index + 1,
      title: track.title ?? track.recording?.title ?? '',
      durationMs: track.length ?? track.recording?.length ?? 0,
    })),
  );
  const result = createTarget({
    type: 'album',
    artist: artistCreditName(release['artist-credit']),
    title: release.title ?? '',
    tracks,
    year: parseYear(release.date),
    mbid: release.id,
  });
  return result.isOk() ? result.value : undefined;
}

export function recordingToTarget(json: unknown): Target | undefined {
  const recording = json as MbRecording;
  const result = createTarget({
    type: 'track',
    artist: artistCreditName(recording['artist-credit']),
    title: recording.title ?? '',
    tracks: [{ position: 1, title: recording.title ?? '', durationMs: recording.length ?? 0 }],
    mbid: recording.id,
  });
  return result.isOk() ? result.value : undefined;
}

/** The confident best match's id, or `undefined` when the results are empty, weak, or ambiguous. */
export function bestMatchId(entries: readonly ScoredEntry[] | undefined): string | undefined {
  const scored = (entries ?? []).map((entry) => ({ id: entry.id, score: entry.score ?? 0 }));
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  const second = scored[1];
  if (best === undefined || best.score < HIGH_CONFIDENCE) return undefined;
  if (second !== undefined && best.score - second.score < AMBIGUITY_MARGIN) return undefined;
  return best.id;
}

import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

/**
 * The normalized, source-agnostic description of what a caller wants to acquire (D11).
 * A plain, serializable value object — it is carried on events and must round-trip as JSON,
 * so it holds no methods. Downstream matching reads only these fields, never source-specific ones.
 */
export type TargetType = 'album' | 'track';

export interface TrackMetadata {
  readonly position: number;
  readonly title: string;
  readonly durationMs: number;
}

export interface Target {
  readonly type: TargetType;
  readonly artist: string;
  readonly title: string;
  readonly tracks: readonly TrackMetadata[];
  readonly year?: number;
  readonly mbid?: string;
}

export type TargetInput = Target;

export type TargetError =
  | { readonly kind: 'EmptyArtist' }
  | { readonly kind: 'EmptyTitle' }
  | { readonly kind: 'NoTracks' }
  | { readonly kind: 'InvalidTrackDuration'; readonly position: number };

/** Smart constructor: enforces the Target invariants, returning errors as values (D3). */
export function createTarget(input: TargetInput): Result<Target, TargetError> {
  const artist = input.artist.trim();
  if (artist === '') return err({ kind: 'EmptyArtist' });

  const title = input.title.trim();
  if (title === '') return err({ kind: 'EmptyTitle' });

  if (input.tracks.length === 0) return err({ kind: 'NoTracks' });

  for (const track of input.tracks) {
    if (track.durationMs <= 0) {
      return err({ kind: 'InvalidTrackDuration', position: track.position });
    }
  }

  return ok({
    type: input.type,
    artist,
    title,
    tracks: input.tracks,
    year: input.year,
    mbid: input.mbid,
  });
}

export function trackCount(target: Target): number {
  return target.tracks.length;
}

export function totalDurationMs(target: Target): number {
  return target.tracks.reduce((sum, track) => sum + track.durationMs, 0);
}

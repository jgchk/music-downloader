import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { branded } from '../shared/brand.js';
import type { Brand } from '../shared/brand.js';
import type { Mbid } from '../shared/mbid.js';

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

/**
 * Branded (compile-time only, runtime-erased) so a validated target cannot be forged from a raw
 * object literal — the only source is {@link createTarget}. The value still serializes on events
 * as plain JSON.
 */
export type Target = Brand<
  {
    readonly type: TargetType;
    readonly artist: string;
    readonly title: string;
    readonly tracks: readonly TrackMetadata[];
    readonly year?: number;
    readonly mbid?: Mbid;
  },
  'Target'
>;

/** The unvalidated shape accepted by {@link createTarget}: the target fields without the brand. */
export interface TargetInput {
  readonly type: TargetType;
  readonly artist: string;
  readonly title: string;
  readonly tracks: readonly TrackMetadata[];
  readonly year?: number;
  readonly mbid?: Mbid;
}

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

  return ok(
    branded<Target>({
      type: input.type,
      artist,
      title,
      tracks: input.tracks,
      year: input.year,
      mbid: input.mbid,
    }),
  );
}

export function trackCount(target: Target): number {
  return target.tracks.length;
}

export function totalDurationMs(target: Target): number {
  return target.tracks.reduce((sum, track) => sum + track.durationMs, 0);
}

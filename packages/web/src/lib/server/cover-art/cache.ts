import { ResultAsync, okAsync } from 'neverthrow';
import type {
  CoverArtAnswer,
  CoverArtEntity,
  CoverArtPort,
  CoverArtSize,
  CoverArtUnavailable,
} from './port.js';

/**
 * A cache in front of a {@link CoverArtPort}, as a decorator so the caching decision is separable
 * from the archive conversation and either can be tested without the other.
 *
 * Two rules carry the whole design. Only ANSWERS are remembered — art, and the archive's own "no
 * art for this" — while a fault is never written, because remembering an outage as absence would
 * hide a cover permanently. And the cache is bounded in BYTES rather than entries, because that is
 * what actually grows: covers vary from a few kilobytes to a few hundred, so an entry count is no
 * budget at all. Art is always re-fetchable, so eviction is safe at any moment.
 *
 * The byte budget bounds the IMAGES; a separate entry ceiling bounds everything, because an
 * absence costs no bytes at all and would otherwise accumulate a key per identifier ever asked
 * about — millions of release groups have no art, and a grid asks about twenty-five at a time.
 * Both are ceilings on the same insertion-ordered map, so the oldest key goes first either way.
 */

export interface CoverArtCacheConfig {
  /** How long an answer stays fresh. Art rarely changes; the archive gaining art is the reason. */
  readonly ttlMs?: number;
  /** The byte budget for cached images. Absences cost nothing but their key. */
  readonly maxBytes?: number;
  /** The ceiling on entries of any kind — what actually bounds remembered absences. */
  readonly maxEntries?: number;
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;
/** Generous for one household's browsing, and finite, which is the point. */
const DEFAULT_MAX_ENTRIES = 4096;

interface Entry {
  readonly answer: CoverArtAnswer;
  readonly bytes: number;
  readonly at: number;
}

const keyOf = (entity: CoverArtEntity, mbid: string, size: CoverArtSize): string =>
  `${entity}/${mbid}/${size}`;

const sizeOf = (answer: CoverArtAnswer): number =>
  answer.kind === 'found' ? answer.image.bytes.byteLength : 0;

export function cachingCoverArt(
  inner: CoverArtPort,
  config: CoverArtCacheConfig = {},
  now: () => number = Date.now,
): CoverArtPort {
  const ttlMs = config.ttlMs ?? DEFAULT_TTL_MS;
  const maxBytes = config.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxEntries = config.maxEntries ?? DEFAULT_MAX_ENTRIES;
  // Insertion order is recency order: a hit re-inserts, so the oldest key is the least recently
  // used one — which is exactly what a Map's iteration order gives for free.
  const entries = new Map<string, Entry>();
  /** Reads already on the wire, so a page of tiles asking for one cover asks the archive once. */
  const inFlight = new Map<string, ResultAsync<CoverArtAnswer, CoverArtUnavailable>>();
  let heldBytes = 0;

  const forget = (key: string): void => {
    const entry = entries.get(key);
    if (entry === undefined) return;
    entries.delete(key);
    heldBytes -= entry.bytes;
  };

  const remember = (key: string, answer: CoverArtAnswer): void => {
    const bytes = sizeOf(answer);
    // One image larger than the whole budget is served but not held: caching it would evict
    // everything else to hold a single cover.
    if (bytes > maxBytes) return;
    forget(key);
    entries.set(key, { answer, bytes, at: now() });
    heldBytes += bytes;
    for (const [oldest] of entries) {
      if (heldBytes <= maxBytes && entries.size <= maxEntries) break;
      forget(oldest);
    }
  };

  return {
    front(entity, mbid, size) {
      const key = keyOf(entity, mbid, size);
      const entry = entries.get(key);
      if (entry !== undefined) {
        if (now() - entry.at <= ttlMs) {
          entries.delete(key);
          entries.set(key, entry);
          return okAsync(entry.answer);
        }
        forget(key);
      }
      const existing = inFlight.get(key);
      // Derived from the shared read rather than re-issued: `map` returns a new ResultAsync over
      // the SAME pending request, so every concurrent caller is served by one archive round trip.
      if (existing !== undefined) return existing.map((answer) => answer);

      // Built over a plain promise so the entry is cleared however the read ends — including a
      // REJECTION, which `andTee`/`orTee` never see: neverthrow propagates one straight through.
      // An entry left behind would make one failure this cover's answer for the life of the
      // process, and hand every later caller a rejection where the port promises a Result.
      const settled = (async () => {
        try {
          const answer = await inner.front(entity, mbid, size);
          if (answer.isOk()) remember(key, answer.value);
          return answer;
        } finally {
          inFlight.delete(key);
        }
      })();
      const pending = new ResultAsync(settled);
      inFlight.set(key, pending);
      return pending;
    },
  };
}

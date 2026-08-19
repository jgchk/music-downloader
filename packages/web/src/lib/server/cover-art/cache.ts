import { okAsync } from 'neverthrow';
import type { CoverArtAnswer, CoverArtEntity, CoverArtPort, CoverArtSize } from './port.js';

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
 * The budget bounds the IMAGES. An absence costs only its key and is therefore not bounded by it —
 * absences leave only on expiry. That is fine while the key space is one household's browsing, and
 * would need revisiting if this were ever put in front of a crawler.
 */

export interface CoverArtCacheConfig {
  /** How long an answer stays fresh. Art rarely changes; the archive gaining art is the reason. */
  readonly ttlMs?: number;
  /** The byte budget for cached images. Absences cost nothing but their key. */
  readonly maxBytes?: number;
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;

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
  // Insertion order is recency order: a hit re-inserts, so the oldest key is the least recently
  // used one — which is exactly what a Map's iteration order gives for free.
  const entries = new Map<string, Entry>();
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
      if (heldBytes <= maxBytes) break;
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
      return inner.front(entity, mbid, size).map((answer) => {
        remember(key, answer);
        return answer;
      });
    },
  };
}

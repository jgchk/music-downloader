import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { branded } from '../shared/brand.js';
import type { Brand } from '../shared/brand.js';

/**
 * Quality as ordered buckets + a hard floor (D11), not a continuous scalar — so hi-res never
 * out-ranks 16/44 when unwanted, and sub-floor candidates are *excluded*, not penalized.
 * Buckets are measurable tiers resolved from probe (or advertised) attributes; a user-supplied
 * `order` lets preference be reordered without touching resolution.
 */
export type QualityBucket =
  'LOSSLESS_HIRES' | 'LOSSLESS' | 'LOSSY_HIGH' | 'LOSSY_STANDARD' | 'LOSSY_LOW' | 'UNKNOWN';

/** The canonical highest-to-lowest ordering. */
export const QUALITY_BUCKETS: readonly QualityBucket[] = [
  'LOSSLESS_HIRES',
  'LOSSLESS',
  'LOSSY_HIGH',
  'LOSSY_STANDARD',
  'LOSSY_LOW',
  'UNKNOWN',
];

/** Attributes a bucket is resolved from — probed post-download, or advertised at search time. */
export interface QualityAttributes {
  readonly codec: string;
  readonly bitrate?: number; // bits per second
  readonly sampleRate?: number; // Hz
  readonly bitDepth?: number; // bits per sample
  readonly lossless?: boolean;
}

const LOSSLESS_CODECS: ReadonlySet<string> = new Set([
  'flac',
  'alac',
  'wav',
  'wave',
  'aiff',
  'aif',
  'ape',
  'wavpack',
  'wv',
  'tak',
  'tta',
]);

const HIRES_BIT_DEPTH = 16;
const HIRES_SAMPLE_RATE = 48_000;
const LOSSY_HIGH_BPS = 256_000;
const LOSSY_STANDARD_BPS = 128_000;

/** Reason about the probed codec, not the file extension (D5). */
export function resolveQualityBucket(attributes: QualityAttributes): QualityBucket {
  const codec = attributes.codec.trim().toLowerCase();
  const isLossless = attributes.lossless ?? (codec !== '' && LOSSLESS_CODECS.has(codec));

  if (isLossless) {
    const isHires =
      (attributes.bitDepth ?? HIRES_BIT_DEPTH) > HIRES_BIT_DEPTH ||
      (attributes.sampleRate ?? HIRES_SAMPLE_RATE) > HIRES_SAMPLE_RATE;
    return isHires ? 'LOSSLESS_HIRES' : 'LOSSLESS';
  }

  if (codec === '' && attributes.lossless === undefined) return 'UNKNOWN';

  const { bitrate } = attributes;
  if (bitrate === undefined) return 'UNKNOWN';
  if (bitrate >= LOSSY_HIGH_BPS) return 'LOSSY_HIGH';
  if (bitrate >= LOSSY_STANDARD_BPS) return 'LOSSY_STANDARD';
  return 'LOSSY_LOW';
}

export type QualityPolicy = Brand<
  {
    readonly order: readonly QualityBucket[];
    readonly floor: QualityBucket;
  },
  'QualityPolicy'
>;

export type QualityPolicyError =
  { readonly kind: 'EmptyOrder' } | { readonly kind: 'FloorNotInOrder' };

export function createQualityPolicy(
  order: readonly QualityBucket[],
  floor: QualityBucket,
): Result<QualityPolicy, QualityPolicyError> {
  if (order.length === 0) return err({ kind: 'EmptyOrder' });
  if (!order.includes(floor)) return err({ kind: 'FloorNotInOrder' });
  return ok(branded<QualityPolicy>({ order: [...order], floor }));
}

export const DEFAULT_QUALITY_POLICY: QualityPolicy = createQualityPolicy(
  QUALITY_BUCKETS,
  'LOSSY_LOW',
)._unsafeUnwrap();

/** Rank within the policy order; absent buckets sort worst (Infinity). Lower rank = higher quality. */
export function bucketRank(policy: QualityPolicy, bucket: QualityBucket): number {
  const index = policy.order.indexOf(bucket);
  return index === -1 ? Infinity : index;
}

/** A bucket clears the floor iff it is at least as good as the floor (D11). */
export function isFloorMet(policy: QualityPolicy, bucket: QualityBucket): boolean {
  return bucketRank(policy, bucket) <= bucketRank(policy, policy.floor);
}

/** Negative when `a` is higher quality than `b`; suitable for ascending sort by rank. */
export function compareQuality(policy: QualityPolicy, a: QualityBucket, b: QualityBucket): number {
  return bucketRank(policy, a) - bucketRank(policy, b);
}

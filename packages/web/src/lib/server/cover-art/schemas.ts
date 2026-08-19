import { z } from 'zod';

/**
 * The consumer contract for the Cover Art Archive's manifest (`GET /{entity}/{mbid}`). Only the
 * fields the adapter reads are modeled and unknown ones are stripped, so the archive adding data
 * is not drift; a consumed field changing type is, and fails at the boundary.
 *
 * The image BYTES have no shape to pin — they are an opaque payload the adapter passes through —
 * so the manifest is the whole recordable contract.
 */
const coverArtImageSchema = z.object({
  /** Whether this image is the front cover; anything else is not what a picker shows. */
  front: z.boolean().optional(),
  /** The full-size image, used when the archive has no thumbnail at the asked-for size. */
  image: z.string().optional(),
  /** Keyed by pixel width. Absent sizes are normal — not every image is thumbnailed. */
  thumbnails: z
    .object({ '250': z.string().optional(), '500': z.string().optional() })
    .optional(),
});

export const coverArtManifestSchema = z.object({
  images: z.array(coverArtImageSchema).optional(),
});

export type CoverArtManifest = z.infer<typeof coverArtManifestSchema>;

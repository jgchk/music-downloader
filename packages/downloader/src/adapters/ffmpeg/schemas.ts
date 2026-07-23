import { z } from 'zod';

/**
 * The codified consumer contract for `ffprobe -print_format json` output. These schemas model only
 * the fields the probe adapter reads (D5) and tolerate unknown ones — ffprobe emits dozens of fields
 * per stream, so `z.object` strips extras rather than rejecting. A *consumed* field changing type
 * fails validation, turning a broken or incompatible ffprobe into a modeled boundary failure at parse
 * time rather than a silent all-`undefined` degrade. The inferred types replace the hand-written
 * interfaces so the contract and the compile-time view of the payload cannot diverge.
 *
 * Bit depth arrives under two field names depending on codec: `bits_per_raw_sample` (a *string*) on
 * most lossless codecs, `bits_per_sample` (a *number*) on others — both are modeled so the adapter
 * can prefer the former and fall back to the latter.
 */
export const ffprobeStreamSchema = z.object({
  codec_type: z.string().optional(),
  codec_name: z.string().optional(),
  sample_rate: z.string().optional(), // Hz, as a string
  channels: z.number().optional(),
  bits_per_raw_sample: z.string().optional(), // bit depth, as a string
  bits_per_sample: z.number().optional(), // bit depth, as a number (alternate field)
  bit_rate: z.string().optional(), // bits/sec, as a string
  duration: z.string().optional(), // seconds, as a string
});

export const ffprobeOutputSchema = z.object({
  streams: z.array(ffprobeStreamSchema).optional(),
  format: z.object({ duration: z.string().optional(), bit_rate: z.string().optional() }).optional(),
});

export type FfprobeStream = z.infer<typeof ffprobeStreamSchema>;
export type FfprobeOutput = z.infer<typeof ffprobeOutputSchema>;

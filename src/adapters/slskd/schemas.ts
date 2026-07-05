import { z } from 'zod';

/**
 * The codified consumer contract for the slskd REST API (v0). These schemas model only the fields
 * the search and download adapters read (D1) and tolerate unknown fields — slskd adding data is not
 * drift, so `z.object` strips extras rather than rejecting. A *consumed* field going missing or
 * changing type fails validation, turning provider drift into a modeled boundary failure at parse
 * time (D2). The inferred types replace the hand-written interfaces so the contract and the
 * compile-time view of the payloads cannot diverge.
 */

/** `POST /api/v0/searches` and `GET /api/v0/searches/{id}`. */
export const slskdSearchStateSchema = z.object({
  id: z.string().optional(),
  isComplete: z.boolean().optional(),
});

const slskdSearchFileSchema = z.object({
  filename: z.string().optional(),
  size: z.number().optional(),
  bitRate: z.number().optional(), // kbps
  sampleRate: z.number().optional(), // Hz
  bitDepth: z.number().optional(), // bits/sample
  length: z.number().optional(), // seconds
});

const slskdSearchResponseSchema = z.object({
  username: z.string().optional(),
  hasFreeUploadSlot: z.boolean().optional(),
  uploadSpeed: z.number().optional(), // bytes/sec
  queueLength: z.number().optional(),
  files: z.array(slskdSearchFileSchema).optional(),
});

/** `GET /api/v0/searches/{id}/responses` — a flat array of per-peer responses. */
export const slskdSearchResponsesSchema = z.array(slskdSearchResponseSchema);

const slskdTransferSchema = z.object({
  id: z.string().optional(),
  filename: z.string().optional(),
  state: z.string().optional(),
  size: z.number().optional(),
  bytesTransferred: z.number().optional(),
  placeInQueue: z.number().optional(),
  exception: z.string().optional(),
});

/**
 * `GET /api/v0/transfers/downloads/{username}` — a single user object whose transfers are grouped
 * by directory (verified against slskd 0.22.5; the pre-fix hand-written stub had this as a bare
 * array and silently drifted from reality — the shape this contract now pins).
 */
export const slskdTransfersSchema = z.object({
  directories: z.array(z.object({ files: z.array(slskdTransferSchema).optional() })).optional(),
});

export type SlskdSearchState = z.infer<typeof slskdSearchStateSchema>;
export type SlskdSearchFile = z.infer<typeof slskdSearchFileSchema>;
export type SlskdSearchResponse = z.infer<typeof slskdSearchResponseSchema>;
export type SlskdTransfer = z.infer<typeof slskdTransferSchema>;
export type SlskdTransfersPayload = z.infer<typeof slskdTransfersSchema>;

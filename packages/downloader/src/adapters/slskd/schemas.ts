import { z } from 'zod';

/**
 * The codified consumer contract for the slskd REST API (v0). These schemas model only the fields
 * the search and download adapters read (D1) and tolerate unknown fields — slskd adding data is not
 * drift, so `z.object` strips extras rather than rejecting. A *consumed* field going missing or
 * changing type fails validation, turning provider drift into a modeled boundary failure at parse
 * time (D2). The inferred types replace the hand-written interfaces so the contract and the
 * compile-time view of the payloads cannot diverge.
 */

/**
 * `POST /api/v0/searches` and `GET /api/v0/searches/{id}`. `state`/`responseCount` describe the
 * search's own bookkeeping: slskd (observed on 0.22.5) counts responses as they arrive but
 * persists them only at finalization, so a harvest is trusted only when `isComplete` — and a
 * non-zero `responseCount` must be matched by a non-empty harvest (harvest integrity).
 */
export const slskdSearchStateSchema = z.object({
  id: z.string().optional(),
  isComplete: z.boolean().optional(),
  state: z.string().optional(),
  responseCount: z.number().optional(),
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

/**
 * `GET /api/v0/events` — a persisted, newest-first, paginated log. Each record's `data` is a
 * JSON-encoded *string* (not an inline object); the concrete payload varies by `type`, so the
 * record keeps `data` as an opaque string here and the resolver decodes only the records it wants.
 * `type` and `data` are consumed (missing/mistyped fails parse); `timestamp`/`id` are tolerated.
 */
const slskdEventRecordSchema = z.object({
  type: z.string(),
  data: z.string(),
  timestamp: z.string().optional(),
  id: z.string().optional(),
});

/** `GET /api/v0/events` — a flat array of event records. */
export const slskdEventsSchema = z.array(slskdEventRecordSchema);

/**
 * The `data` payload of a `DownloadFileComplete` event, decoded from the record's JSON string.
 * `localFilename` (the authoritative absolute path slskd wrote) and `transfer.id` (the correlation
 * key back to our poll) are consumed and required; `remoteFilename` is carried but tolerated.
 */
export const slskdDownloadFileCompleteSchema = z.object({
  localFilename: z.string(),
  remoteFilename: z.string().optional(),
  transfer: z.object({ id: z.string() }),
});

/** `GET /api/v0/options` — the only field consumed is the configured downloads root. */
export const slskdOptionsSchema = z.object({
  directories: z.object({ downloads: z.string() }),
});

export type SlskdSearchState = z.infer<typeof slskdSearchStateSchema>;
export type SlskdSearchFile = z.infer<typeof slskdSearchFileSchema>;
export type SlskdSearchResponse = z.infer<typeof slskdSearchResponseSchema>;
export type SlskdTransfer = z.infer<typeof slskdTransferSchema>;
export type SlskdTransfersPayload = z.infer<typeof slskdTransfersSchema>;
export type SlskdEventRecord = z.infer<typeof slskdEventRecordSchema>;
export type SlskdDownloadFileComplete = z.infer<typeof slskdDownloadFileCompleteSchema>;

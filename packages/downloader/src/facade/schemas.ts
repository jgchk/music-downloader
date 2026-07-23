import { z } from 'zod';

/**
 * The module's wire-shaped DTO contracts: one zod source of truth consumed by every interface
 * through the facade (today the web BFF; any future HTTP/CLI/MCP binding projects these same
 * schemas onto its transport). Deliberately *separate* from the domain models (inbound
 * anti-corruption): they evolve additively and never expose domain types on the wire.
 */

// --- Enumerations (wire copies, intentionally decoupled from the domain's own enums) -----------

export const qualityBucketSchema = z.enum([
  'LOSSLESS_HIRES',
  'LOSSLESS',
  'LOSSY_HIGH',
  'LOSSY_STANDARD',
  'LOSSY_LOW',
  'UNKNOWN',
]);

export const acquisitionStatusSchema = z.enum([
  'Empty',
  'Pending',
  'AwaitingManualSelection',
  'Searching',
  'Selecting',
  'Downloading',
  'Validating',
  'Importing',
  'Fulfilled',
  'Exhausted',
  'Cancelled',
  'MetadataFailed',
  'Conflicted',
]);

export const downloadFailureReasonSchema = z.enum([
  'PeerUnavailable',
  'Stalled',
  'QueueTimeout',
  'TransferError',
  'FileUnavailable',
  'Cancelled',
]);

export const validationReasonSchema = z.enum([
  'Unplayable',
  'WrongTrackCount',
  'DurationMismatch',
  'RecordingMismatch',
  'QualityNotAuthentic',
]);

export const targetTypeSchema = z.enum(['album', 'track']);

// --- Submit request ----------------------------------------------------------------------------

export const acquisitionRequestSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('musicbrainz'),
    mbid: z.string().min(1),
    targetType: targetTypeSchema,
  }),
  z.object({
    // A MusicBrainz release-*group* id (an album identity); resolved to a representative official
    // edition. Albums only — a release group has no track (recording) analogue.
    kind: z.literal('release-group'),
    mbid: z.string().min(1),
    targetType: z.literal('album'),
  }),
  z.object({
    kind: z.literal('descriptor'),
    targetType: targetTypeSchema,
    artist: z.string().min(1),
    title: z.string().min(1),
    album: z.string().min(1).optional(),
  }),
]);

export const qualityPolicySchema = z.object({
  order: z.array(qualityBucketSchema).min(1).optional(),
  floor: qualityBucketSchema.optional(),
});

export const matchPolicySchema = z.object({
  threshold: z.number().min(0).max(1).optional(),
});

export const retryPolicySchema = z.object({
  maxSearchRounds: z.number().int().positive().optional(),
  maxTotalAttempts: z.number().int().positive().optional(),
  timeBudgetMs: z.number().int().positive().optional(),
});

export const downloadPolicySchema = z.object({
  stallTimeoutMs: z.number().int().positive().optional(),
  maxQueueWaitMs: z.number().int().positive().optional(),
});

export const submitAcquisitionRequestSchema = z.object({
  request: acquisitionRequestSchema,
  qualityPolicy: qualityPolicySchema.optional(),
  matchPolicy: matchPolicySchema.optional(),
  retryPolicy: retryPolicySchema.optional(),
  downloadPolicy: downloadPolicySchema.optional(),
});

// --- Responses ---------------------------------------------------------------------------------

export const candidateIdentitySchema = z.object({
  username: z.string(),
  path: z.string(),
  sizeBytes: z.number(),
});

// Every entry carries `at`, the ISO-8601 occurrence time of the event it projects, so a consumer
// can order this acquisition's history against another context's history in real time (additive).
export const historyEntrySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('selected'),
    at: z.iso.datetime(),
    candidate: candidateIdentitySchema,
  }),
  z.object({
    kind: z.literal('download-failed'),
    at: z.iso.datetime(),
    candidate: candidateIdentitySchema,
    reason: downloadFailureReasonSchema,
  }),
  z.object({
    kind: z.literal('validation-failed'),
    at: z.iso.datetime(),
    candidate: candidateIdentitySchema,
    reasons: z.array(validationReasonSchema),
  }),
  z.object({
    kind: z.literal('imported'),
    at: z.iso.datetime(),
    candidate: candidateIdentitySchema,
    location: z.string(),
  }),
  z.object({
    // A delivered candidate rejected by validation outside the system (free-form reasons).
    kind: z.literal('fulfillment-rejected'),
    at: z.iso.datetime(),
    candidate: candidateIdentitySchema,
    reasons: z.array(z.string()),
  }),
]);

export const acquisitionTargetSchema = z.object({
  artist: z.string(),
  title: z.string(),
});

/** One edition on offer while an acquisition awaits manual selection (wire copy of the domain value). */
export const editionCandidateSchema = z.object({
  releaseMbid: z.string(),
  title: z.string().optional(),
  date: z.string().optional(),
  country: z.string().optional(),
  format: z.string().optional(),
  // Absent when the edition's track count is unknown (v2 EditionCandidate; legacy v1 stored 0).
  trackCount: z.number().optional(),
});

export const acquisitionStatusResponseSchema = z.object({
  acquisitionId: z.string(),
  status: acquisitionStatusSchema,
  // Present once metadata has resolved the request into an artist/title (absent while Pending).
  target: acquisitionTargetSchema.optional(),
  // Present only while a candidate is in flight (Selecting through Importing); absent once terminal.
  currentCandidate: candidateIdentitySchema.optional(),
  attempts: z.number(),
  rejectedCount: z.number(),
  // Present only once the release has been imported into the library (status Fulfilled/Conflicted).
  location: z.string().optional(),
  history: z.array(historyEntrySchema),
  // Present only while status is AwaitingManualSelection (additive).
  candidates: z.array(editionCandidateSchema).optional(),
  // Present (true) only when the acquisition dead-lettered awaiting an operator (additive).
  stalled: z.boolean().optional(),
});

export const acquisitionListResponseSchema = z.object({
  acquisitions: z.array(acquisitionStatusResponseSchema),
});

export const progressResponseSchema = z.object({
  percent: z.number(),
  bytesTransferred: z.number(),
  bytesTotal: z.number(),
  queuePosition: z.number().optional(),
});

export const submitAcquisitionResponseSchema = z.object({
  acquisitionId: z.string(),
  statusUrl: z.string(),
});

export const cancelAcquisitionResponseSchema = z.object({
  acquisitionId: z.string(),
});

export const acquisitionIdParamsSchema = z.object({
  id: z.string().min(1),
});

/** Arguments for the `cancel_acquisition` MCP tool (mirrors the HTTP id param). */
export const cancelAcquisitionArgsSchema = z.object({
  id: z.string().min(1),
});

export const errorResponseSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
});

// --- Inferred DTO types (the interface layer's public vocabulary) ------------------------------

export type AcquisitionRequestDto = z.infer<typeof acquisitionRequestSchema>;
export type SubmitAcquisitionRequestDto = z.infer<typeof submitAcquisitionRequestSchema>;
export type SubmitAcquisitionResponseDto = z.infer<typeof submitAcquisitionResponseSchema>;
export type AcquisitionStatusResponseDto = z.infer<typeof acquisitionStatusResponseSchema>;
export type AcquisitionListResponseDto = z.infer<typeof acquisitionListResponseSchema>;
export type EditionCandidateDto = z.infer<typeof editionCandidateSchema>;
export type ProgressResponseDto = z.infer<typeof progressResponseSchema>;
export type CancelAcquisitionResponseDto = z.infer<typeof cancelAcquisitionResponseSchema>;
export type ErrorResponseDto = z.infer<typeof errorResponseSchema>;

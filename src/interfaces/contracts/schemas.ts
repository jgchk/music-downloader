import { z } from 'zod';

/**
 * The versioned wire contracts (D12): one zod source of truth that drives HTTP request/response
 * validation (via `fastify-type-provider-zod`), the published OpenAPI document (via
 * `@fastify/swagger`), and the MCP tool JSON Schemas (via `z.toJSONSchema`) — so the three surfaces
 * cannot drift. These DTOs are deliberately *separate* from the domain models (inbound
 * anti-corruption): they evolve additively within `/api/v1` and never expose domain types on the
 * wire.
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

export const historyEntrySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('selected'), candidate: candidateIdentitySchema }),
  z.object({
    kind: z.literal('download-failed'),
    candidate: candidateIdentitySchema,
    reason: downloadFailureReasonSchema,
  }),
  z.object({
    kind: z.literal('validation-failed'),
    candidate: candidateIdentitySchema,
    reasons: z.array(validationReasonSchema),
  }),
  z.object({
    kind: z.literal('imported'),
    candidate: candidateIdentitySchema,
    location: z.string(),
  }),
  z.object({
    // A delivered candidate rejected by validation outside the system (free-form reasons).
    kind: z.literal('fulfillment-rejected'),
    candidate: candidateIdentitySchema,
    reasons: z.array(z.string()),
  }),
]);

export const acquisitionStatusResponseSchema = z.object({
  acquisitionId: z.string(),
  status: acquisitionStatusSchema,
  currentCandidate: candidateIdentitySchema.optional(),
  attempts: z.number(),
  rejectedCount: z.number(),
  location: z.string().optional(),
  history: z.array(historyEntrySchema),
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
export type ProgressResponseDto = z.infer<typeof progressResponseSchema>;
export type CancelAcquisitionResponseDto = z.infer<typeof cancelAcquisitionResponseSchema>;
export type ErrorResponseDto = z.infer<typeof errorResponseSchema>;

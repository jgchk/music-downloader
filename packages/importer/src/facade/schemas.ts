import { z } from 'zod';

/**
 * The module's wire-shaped DTO contracts: one zod source of truth consumed by every interface
 * through the facade (today the web BFF; any future HTTP/CLI/MCP binding projects these same
 * schemas onto its transport). Deliberately *separate* from the domain models (inbound
 * anti-corruption): they evolve additively and never expose domain types on the wire.
 */

// --- Enumerations (wire copies, intentionally decoupled from the domain's own unions) ----------

export const importPhaseSchema = z.enum([
  'empty',
  'requested',
  'proposing',
  'awaiting-review',
  'applying',
  'applied',
  'rejected',
]);

export const reviewKindSchema = z.enum([
  'match-review',
  'no-match',
  'duplicate-review',
  'remediation-review',
]);

export const resolutionVerbSchema = z.enum([
  'apply-candidate',
  'supply-id',
  'refresh-candidates',
  'manual-tags',
  'import-as-is',
  'reject',
  'reject-and-retry-download',
  'accept',
  'retry-enrichment',
]);

export const duplicateActionSchema = z.enum(['replace', 'keep-both']);

// --- Shared shapes -----------------------------------------------------------------------------

export const candidateRefSchema = z.object({
  dataSource: z.string().min(1),
  albumId: z.string().min(1),
});

export const candidatePenaltySchema = z.object({
  name: z.string(),
  amount: z.number(),
});

/** The staged file's current embedded tags for a mapped track — the before-side of a retag diff. */
export const trackCurrentTagsSchema = z.object({
  title: z.string(),
  artist: z.string(),
  track: z.number().int(),
  // Absent when the file's duration could not be read (never a false 0).
  length: z.number().optional(),
});

export const trackMappingSchema = z.object({
  path: z.string(),
  title: z.string(),
  index: z.number().int(),
  // Additive diff evidence: the file's current tags and how far this mapped pair is from clean.
  current: trackCurrentTagsSchema.optional(),
  distance: z.number().optional(),
});

/** A downloaded file the candidate placed against no track (the `unmatched_tracks` penalty). */
export const unmatchedFileSchema = z.object({
  path: z.string(),
  title: z.string(),
  track: z.number().int(),
});

/** A candidate track no downloaded file supplied (the `missing_tracks` penalty). */
export const missingTrackSchema = z.object({
  title: z.string(),
  index: z.number().int(),
});

/** The candidate's album-level fields, for the album-field diff against the files' current tags. */
export const candidateAlbumFieldsSchema = z.object({
  year: z.number().int(),
  media: z.string(),
  label: z.string(),
  catalognum: z.string(),
  country: z.string(),
  albumDisambig: z.string(),
});

export const candidateSchema = z.object({
  ref: candidateRefSchema,
  artist: z.string(),
  album: z.string(),
  distance: z.number(),
  penalties: z.array(candidatePenaltySchema),
  tracks: z.array(trackMappingSchema),
  // Additive field-level diff evidence; optional so pre-change reviews still project.
  extraItems: z.array(unmatchedFileSchema).optional(),
  missingTracks: z.array(missingTrackSchema).optional(),
  albumFields: candidateAlbumFieldsSchema.optional(),
});

export const incumbentSchema = z.object({
  artist: z.string(),
  album: z.string(),
  path: z.string(),
});

export const applyFailureSchema = z.object({
  stage: z.string(),
  message: z.string(),
});

export const importHintsSchema = z.object({
  mbReleaseId: z.string().min(1).optional(),
  artist: z.string().min(1).optional(),
  album: z.string().min(1).optional(),
});

// --- Submit ------------------------------------------------------------------------------------

export const submitImportRequestSchema = z.object({
  path: z.string().min(1),
  hints: importHintsSchema.optional(),
});

export const submitImportResponseSchema = z.object({
  importId: z.string(),
  statusUrl: z.string(),
});

// --- Reviews -----------------------------------------------------------------------------------

export const reviewSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('match-review'),
    hinted: z.boolean(),
    // The pinned/hinted release id when one was in play (additive), so a consumer can word the
    // hint outcome truthfully: contradicted iff it differs from `best.albumId`.
    hintedReleaseId: z.string().optional(),
    best: candidateRefSchema.optional(),
    candidates: z.array(candidateSchema),
  }),
  z.object({ kind: z.literal('no-match') }),
  z.object({
    kind: z.literal('duplicate-review'),
    incumbents: z.array(incumbentSchema),
    candidates: z.array(candidateSchema),
  }),
  z.object({
    kind: z.literal('remediation-review'),
    failures: z.array(applyFailureSchema),
  }),
]);

export const manualTrackTagsSchema = z.object({
  path: z.string().min(1),
  title: z.string().min(1),
  artist: z.string().min(1).optional(),
  trackNumber: z.number().int().positive(),
  discNumber: z.number().int().positive().optional(),
});

export const manualTagsSchema = z.object({
  albumArtist: z.string().min(1),
  album: z.string().min(1),
  year: z.number().int().optional(),
  tracks: z.array(manualTrackTagsSchema).min(1),
});

export const resolveReviewRequestSchema = z.discriminatedUnion('verb', [
  z.object({
    verb: z.literal('apply-candidate'),
    candidate: candidateRefSchema,
    duplicateAction: duplicateActionSchema.optional(),
  }),
  z.object({ verb: z.literal('supply-id'), mbReleaseId: z.string().min(1) }),
  z.object({ verb: z.literal('refresh-candidates') }),
  z.object({ verb: z.literal('manual-tags'), tags: manualTagsSchema }),
  z.object({ verb: z.literal('import-as-is') }),
  z.object({ verb: z.literal('reject'), reason: z.string().min(1).optional() }),
  z.object({
    /**
     * Reject (files deleted, import terminal `rejected`) AND record a release verdict so the
     * delivering downloader retries the acquisition with a different copy. Only for imports that
     * arrived from the downloader with a retained candidate; otherwise refused with
     * `NoRetainedCandidate` (plain `reject` remains available). Use `reject` for "wrong thing to
     * have", this verb for "right thing, bad copy".
     */
    verb: z.literal('reject-and-retry-download'),
    reasons: z.array(z.string().min(1)).optional(),
  }),
  z.object({ verb: z.literal('accept') }),
  z.object({ verb: z.literal('retry-enrichment') }),
]);

export const resolveReviewResponseSchema = z.object({
  importId: z.string(),
});

export const pendingReviewSchema = z.object({
  importId: z.string(),
  path: z.string(),
  review: reviewSchema,
});

export const reviewListResponseSchema = z.object({
  reviews: z.array(pendingReviewSchema),
});

// --- Status ------------------------------------------------------------------------------------

// Every entry carries `at`, the ISO-8601 occurrence time of the event it projects, so a consumer
// can order this import's history against another context's history in real time (additive).
export const historyEntrySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('requested'),
    at: z.iso.datetime(),
    hints: importHintsSchema.optional(),
  }),
  z.object({
    kind: z.literal('proposed'),
    at: z.iso.datetime(),
    candidateCount: z.number().int(),
    pinnedId: z.string().optional(),
  }),
  z.object({
    kind: z.literal('auto-apply-selected'),
    at: z.iso.datetime(),
    candidate: candidateRefSchema,
    distance: z.number(),
  }),
  z.object({
    kind: z.literal('review-required'),
    at: z.iso.datetime(),
    reviewKind: reviewKindSchema,
  }),
  z.object({
    kind: z.literal('review-resolved'),
    at: z.iso.datetime(),
    resolution: resolutionVerbSchema,
  }),
  z.object({ kind: z.literal('applied'), at: z.iso.datetime(), location: z.string() }),
  z.object({
    kind: z.literal('remediation-required'),
    at: z.iso.datetime(),
    failures: z.array(applyFailureSchema),
  }),
  z.object({
    kind: z.literal('rejected'),
    at: z.iso.datetime(),
    reason: z.string(),
    filesDeleted: z.boolean(),
  }),
  z.object({
    kind: z.literal('release-verdict-recorded'),
    at: z.iso.datetime(),
    acquisitionId: z.string(),
    reasons: z.array(z.string()),
  }),
]);

export const importStatusResponseSchema = z.object({
  importId: z.string(),
  // Present when the import arrived from an acquisition — the web-side correlation key (additive).
  acquisitionId: z.string().optional(),
  path: z.string().optional(),
  status: importPhaseSchema,
  // Present only once the import has a library location — the terminal `applied` phase (additive).
  location: z.string().optional(),
  // Present only while status is `awaiting-review` — the open review item (additive).
  review: reviewSchema.optional(),
  // Present only when the import terminated in `rejected` (additive).
  rejection: z.object({ reason: z.string(), filesDeleted: z.boolean() }).optional(),
  history: z.array(historyEntrySchema),
});

export const importListResponseSchema = z.object({
  imports: z.array(importStatusResponseSchema),
});

export const importIdParamsSchema = z.object({
  id: z.string().min(1),
});

export const errorResponseSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
});

// Note: if an MCP transport binding ever returns, Anthropic tool-use cannot represent the `oneOf`
// a discriminated-union resolution emits — present a flat, union-free equivalent at that binding
// and translate back onto `ResolveReviewRequestDto` (see the retired adapter in git history).

// --- Inferred DTO types (the interface layer's public vocabulary) ------------------------------

export type SubmitImportRequestDto = z.infer<typeof submitImportRequestSchema>;
export type SubmitImportResponseDto = z.infer<typeof submitImportResponseSchema>;
export type ResolveReviewRequestDto = z.infer<typeof resolveReviewRequestSchema>;
export type ReviewDto = z.infer<typeof reviewSchema>;
export type PendingReviewDto = z.infer<typeof pendingReviewSchema>;
export type ImportStatusResponseDto = z.infer<typeof importStatusResponseSchema>;
export type ImportListResponseDto = z.infer<typeof importListResponseSchema>;
export type ErrorResponseDto = z.infer<typeof errorResponseSchema>;

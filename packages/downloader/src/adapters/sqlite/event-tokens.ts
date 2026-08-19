import type { DownloadEventType } from '../../domain/download/events.js';

/**
 * The storage-token seam (adopt-download-language, design D1).
 *
 * Event type names in the model are ubiquitous language and may be renamed when the language
 * moves. The strings on disk are not language — they are frozen serialization constants, the
 * moral equivalent of protobuf field numbers that happen to have letters in them. History is
 * never rewritten (the store's `(global position, event id)` pair is a delivery contract that
 * consumer checkpoints point into), so a rename lands here, at the one boundary where the two
 * vocabularies meet, and nowhere else.
 *
 * Only the `type` discriminator is mapped; no payload field is renamed by this change, which is
 * what keeps this table small enough to audit at a glance.
 */

/**
 * Model event type -> the token written to and read from disk. Typed as a total record over the
 * event union, so adding an event without deciding its stored token fails to compile.
 */
export const STORED_TOKEN_BY_TYPE: Record<DownloadEventType, string> = {
  DownloadRequested: 'AcquisitionRequested',
  TargetResolved: 'TargetResolved',
  MetadataResolutionFailed: 'MetadataResolutionFailed',
  ManualSelectionRequested: 'ManualSelectionRequested',
  EditionSelected: 'EditionSelected',
  SearchRequested: 'SearchRequested',
  SearchCompleted: 'SearchCompleted',
  CandidatesRanked: 'CandidatesRanked',
  CandidateSelected: 'CandidateSelected',
  TryStarted: 'DownloadStarted',
  TryCompleted: 'DownloadCompleted',
  TryFailed: 'DownloadFailed',
  CandidateRejected: 'CandidateRejected',
  ValidationPassed: 'ValidationPassed',
  ValidationFailed: 'ValidationFailed',
  Imported: 'Imported',
  DownloadFulfilled: 'AcquisitionFulfilled',
  FulfillmentRejected: 'FulfillmentRejected',
  DownloadExhausted: 'AcquisitionExhausted',
  ImportConflicted: 'ImportConflicted',
  DownloadCancelled: 'AcquisitionCancelled',
};

/**
 * The read-side inverse, derived so the two directions cannot drift apart. A duplicate stored
 * token would silently collapse an entry here; the seam's tests assert the sizes still match.
 */
export const MODEL_TYPE_BY_TOKEN: Record<string, DownloadEventType> = Object.fromEntries(
  Object.entries(STORED_TOKEN_BY_TYPE).map(([type, token]) => [token, type as DownloadEventType]),
);

/** Model type -> stored token, for the write path. */
export function toStoredToken(type: DownloadEventType): string {
  return STORED_TOKEN_BY_TYPE[type];
}

/**
 * Stored token -> model type, for the read path. An unrecognized token passes through unchanged:
 * a reader must not lose an event a newer writer stored, and the tolerant fold in the domain is
 * what decides whether the event means anything to it.
 */
export function toModelType(token: string): DownloadEventType {
  return MODEL_TYPE_BY_TOKEN[token] ?? (token as DownloadEventType);
}

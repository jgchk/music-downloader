import type { DownloadEventType } from '../../domain/download/events.js';

/**
 * The storage-token seam (adopt-download-language, design D1).
 *
 * Event type names in the model are ubiquitous language and may be renamed when the language
 * moves. The strings on disk are not language — they are frozen serialization constants, the
 * moral equivalent of protobuf field numbers that happen to have letters in them. History is
 * never rewritten (the store's global positions are a delivery contract that
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

/**
 * Model type -> stored token, for the write path. Total over the union by construction; the
 * explicit guard catches the one way a non-member can arrive — an event round-tripped out of the
 * read path's unknown-token tolerance — and names it, rather than binding `undefined` into SQLite
 * and writing a blob with no `type` at all.
 */
export function toStoredToken(type: DownloadEventType): string {
  // A presence check, not a null check: the mapped type says this cannot miss, and the one way it
  // can is a value that only claims to be a member — an event round-tripped out of the read path's
  // unknown-token tolerance. Naming it beats binding `undefined` into SQLite.
  if (!Object.hasOwn(STORED_TOKEN_BY_TYPE, type)) {
    throw new Error(`no stored token for event type ${type}`);
  }
  return STORED_TOKEN_BY_TYPE[type];
}

/**
 * Stored token -> model type, for the read path. An unrecognized token passes through unchanged so
 * a reader never loses an event a newer writer stored; `evolve` and `react` are total over such a
 * tag (they ignore it and return the state unchanged), which is what makes the tolerance safe
 * rather than a deferred crash. What it does NOT do is publish: an unknown event is skipped by the
 * outbound feed while the checkpoint advances past it, so a token this binary cannot name is
 * invisible downstream. That is acceptable only because there is exactly one writer per store.
 */
export function toModelType(token: string): DownloadEventType {
  return MODEL_TYPE_BY_TOKEN[token] ?? (token as DownloadEventType);
}

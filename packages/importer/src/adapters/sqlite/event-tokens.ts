import type { ImportEventType } from '../../domain/import/events.js';

/**
 * The storage-token seam (adopt-download-language, design D1).
 *
 * Event type names in the model are ubiquitous language and may be renamed when the language
 * moves. The strings on disk are not language — they are frozen serialization constants. History
 * is never rewritten (the store's global positions are a delivery contract that
 * consumer checkpoints point into), so a rename lands here, at the one boundary where the two
 * vocabularies meet, and nowhere else.
 *
 * Only the `type` discriminator is mapped; no payload field is renamed by this change.
 */

/**
 * Model event type -> the token written to and read from disk. Typed as a total record over the
 * event union, so adding an event without deciding its stored token fails to compile.
 */
export const STORED_TOKEN_BY_TYPE: Record<ImportEventType, string> = {
  ImportRequested: 'ImportRequested',
  MatchesProposed: 'CandidatesProposed',
  AutoApplySelected: 'AutoApplySelected',
  ReviewRequired: 'ReviewRequired',
  ReviewResolved: 'ReviewResolved',
  ImportApplied: 'ImportApplied',
  RemediationRequired: 'RemediationRequired',
  ImportRejected: 'ImportRejected',
  ReleaseVerdictRecorded: 'ReleaseVerdictRecorded',
};

/**
 * The read-side inverse, derived so the two directions cannot drift apart. A duplicate stored
 * token would silently collapse an entry here; the seam's tests assert the sizes still match.
 */
// Null-prototype: a lookup keyed by row data must not reach Object.prototype, or a row whose
// `type` column is `toString` resolves to a function where an event type is declared.
export const MODEL_TYPE_BY_TOKEN: Record<string, ImportEventType> = Object.assign(
  Object.create(null) as Record<string, ImportEventType>,
  Object.fromEntries(
    Object.entries(STORED_TOKEN_BY_TYPE).map(([type, token]) => [token, type as ImportEventType]),
  ),
);

/**
 * A model event type with no stored token — definitionally permanent, since no amount of retrying
 * invents a token. This module's InfraError carries no permanent flag, so the importer cannot say
 * so: the effect retries to exhaustion first, and because a retrying effect holds the single
 * global checkpoint at the failing head, every other import queues behind it for the whole budget
 * before it dead-letters. The downloader classifies the same fault permanent and lands it at once.
 */
export class UnmappedEventType extends Error {
  override readonly name = 'UnmappedEventType';

  constructor(readonly eventType: string) {
    super(`no stored token for event type ${eventType}`);
  }
}

/**
 * Model type -> stored token, for the write path. Total over the union by construction; the
 * explicit guard catches the one way a non-member can arrive — an event round-tripped out of the
 * read path's unknown-token tolerance — and names it, rather than binding `undefined` into SQLite
 * and writing a blob with no `type` at all.
 */
export function toStoredToken(type: ImportEventType): string {
  // A presence check, not a null check: the mapped type says this cannot miss, and the one way it
  // can is a value that only claims to be a member — an event round-tripped out of the read path's
  // unknown-token tolerance. Naming it beats binding `undefined` into SQLite.
  if (!Object.hasOwn(STORED_TOKEN_BY_TYPE, type)) {
    throw new UnmappedEventType(type);
  }
  return STORED_TOKEN_BY_TYPE[type];
}

/**
 * Stored token -> model type, for the read path. An unrecognized token passes through unchanged so
 * a reader never loses an event a newer writer stored; `evolve` and `react` are total over such a
 * tag (they ignore it and return the state unchanged), which is what makes the tolerance safe
 * rather than a deferred crash. What it does NOT do is publish: an unknown event is skipped by the
 * outbound feed while the checkpoint advances past it, so a token this binary cannot name is
 * invisible downstream — and permanently, because the checkpoint has already advanced past it.
 * The scenario that produces one is a rollback: an older binary reading a log a newer binary
 * already wrote. Making that loss observable is tracked as follow-up work; today nothing on the
 * path has a logger.
 */
export function toModelType(token: string): ImportEventType {
  return MODEL_TYPE_BY_TOKEN[token] ?? (token as ImportEventType);
}

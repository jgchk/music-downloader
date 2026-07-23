import { branded } from './brand.js';
import type { Brand } from './brand.js';

/**
 * The importer's own aggregate/stream identifier: the deterministic id an import directory converges
 * on (D5). Branded (compile-time only, runtime-erased) so it can never be transposed with a foreign
 * {@link AcquisitionId} at their junction (`importIdForAcquisition`), and so a bare `string` cannot
 * be threaded through the facade/use-cases where an import is addressed.
 *
 * It carries no invariant richer than the event store's generic `streamId` already guarantees, so it
 * is *lifted* into the brand by a trusted mint at two proven origins — the digest `importIdFor`
 * derives, and a `streamId` read back from the importer's own store (the read-model ACL) — rather
 * than re-validated. The id still serializes as a plain string, unchanged.
 */
export type ImportId = Brand<string, 'ImportId'>;

/**
 * Lift a string already known to name an import stream into an {@link ImportId}. Trusted: call it only
 * on the derived id `importIdFor` produces, on a `streamId` read from the importer's own event store,
 * or on a facade id the boundary schema has already proven a non-empty string.
 */
export function toImportId(value: string): ImportId {
  return branded<ImportId>(value);
}

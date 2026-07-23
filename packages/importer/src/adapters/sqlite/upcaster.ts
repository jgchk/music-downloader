import type { ImportEvent } from '../../domain/import/events.js';

/**
 * Event versioning / upcasting seam: persisted events are immutable facts that live forever,
 * so every stored event carries a schema version, and read-side upcasters transform an old shape
 * forward (`v1 → v2 → …`) before `evolve` ever sees it. The seam exists so a schema change is a
 * localized, tested upcaster rather than a migration, exactly the ES form of the no-breaking-change
 * policy. Its first real use lifts the legacy resolution verb (see {@link reviewResolvedV1ToV2}).
 */

/** The schema version stamped on every event written today. */
export const CURRENT_SCHEMA_VERSION = 2;

/** Transforms one on-disk event payload from version N to version N+1. */
export type Upcaster = (data: Record<string, unknown>) => Record<string, unknown>;

export class UpcasterRegistry {
  // event type -> (fromVersion -> upcaster that produces fromVersion + 1)
  private readonly upcasters = new Map<string, Map<number, Upcaster>>();

  /** Register the upcaster that lifts `type` events from `fromVersion` to the next version. */
  register(type: string, fromVersion: number, upcaster: Upcaster): this {
    const forType = this.upcasters.get(type) ?? new Map<number, Upcaster>();
    forType.set(fromVersion, upcaster);
    this.upcasters.set(type, forType);
    return this;
  }

  /**
   * Apply the chain of registered upcasters from `schemaVersion` up to the latest known shape.
   * With nothing registered (the MVP), this is a pass-through: the stored payload is already
   * current and is returned untouched.
   */
  upcast(type: string, schemaVersion: number, data: Record<string, unknown>): ImportEvent {
    const forType = this.upcasters.get(type);
    if (forType === undefined) return data as unknown as ImportEvent;

    let version = schemaVersion;
    let current = data;
    for (let step = forType.get(version); step !== undefined; step = forType.get(version)) {
      current = step(current);
      version += 1;
    }
    return current as unknown as ImportEvent;
  }
}

/**
 * The importer's first upcaster: an earlier version stored the rejection-of-a-bad-delivery verb
 * under the downloader's action name (`reject-and-retry-download`). The importer now speaks its own
 * language (`reject-unusable-delivery`), so a stored v1 `ReviewResolved` carrying the old token is
 * rewritten forward on read — reasons preserved. Any other resolution kind is not this rename's
 * concern and passes through byte-for-byte, so the pure domain only ever sees its own vocabulary.
 */
export const reviewResolvedV1ToV2: Upcaster = (data) => {
  const resolution = data.resolution as { readonly kind?: string } | undefined;
  if (resolution?.kind !== 'reject-and-retry-download') return data;
  return { ...data, resolution: { ...resolution, kind: 'reject-unusable-delivery' } };
};

/** The populated registry wired in composition: every registered upcaster in one testable place. */
export function buildUpcasterRegistry(): UpcasterRegistry {
  return new UpcasterRegistry().register('ReviewResolved', 1, reviewResolvedV1ToV2);
}

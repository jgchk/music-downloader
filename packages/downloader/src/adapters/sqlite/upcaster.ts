import type { AcquisitionEvent } from '../../domain/acquisition/events.js';

/**
 * Event versioning / upcasting seam (D8): persisted events are immutable facts that live forever,
 * so every stored event carries a schema version, and read-side upcasters transform an old shape
 * forward (`v1 → v2 → …`) before `evolve` ever sees it. The MVP registry is pass-through — the
 * seam exists so the first real schema change is a localized, tested upcaster rather than a
 * migration, exactly the ES form of the no-breaking-change policy.
 */

/**
 * The schema version stamped on every event written today.
 *
 * v2 (schema-evolution `EditionCandidate.trackCount`): the `ManualSelectionRequested` edition menu
 * stored an unknown track count as the sentinel `0`; v2 makes the count optional (absent = unknown)
 * and the read-side upcaster folds the legacy `0` to absent. See {@link buildUpcasterRegistry}.
 */
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
  upcast(type: string, schemaVersion: number, data: Record<string, unknown>): AcquisitionEvent {
    const forType = this.upcasters.get(type);
    if (forType === undefined) return data as unknown as AcquisitionEvent;

    let version = schemaVersion;
    let current = data;
    for (let step = forType.get(version); step !== undefined; step = forType.get(version)) {
      current = step(current);
      version += 1;
    }
    return current as unknown as AcquisitionEvent;
  }
}

/**
 * Lifts a v1 `ManualSelectionRequested` to v2: an `EditionCandidate` whose `trackCount` was the v1
 * `0` sentinel (the only way a count of 0 could arise — the MusicBrainz mapping summed per-medium
 * `track-count`s and a music release always has ≥1 track, so 0 meant "no usable media", i.e.
 * unknown) drops the field entirely, matching the v2 "absent = unknown" shape. A real count (`> 0`)
 * passes through unchanged.
 */
const manualSelectionRequestedV1ToV2: Upcaster = (data) => {
  const candidates = Array.isArray(data.candidates) ? data.candidates : [];
  return {
    ...data,
    candidates: candidates.map((candidate: Record<string, unknown>) => {
      if (candidate.trackCount !== 0) return candidate;
      const { trackCount: _unknown, ...rest } = candidate;
      return rest;
    }),
  };
};

/**
 * The downloader's read-side upcaster registry: the single place every known schema-evolution
 * transform is registered, wired into the {@link SqliteEventStore} in composition. An empty
 * registry would silently skip every upcast, so production and tests must build it here.
 */
export function buildUpcasterRegistry(): UpcasterRegistry {
  return new UpcasterRegistry().register(
    'ManualSelectionRequested',
    1,
    manualSelectionRequestedV1ToV2,
  );
}

import type { DownloadEvent } from '../../domain/download/events.js';

/**
 * Event versioning / upcasting seam (D8): persisted events are immutable facts that live forever,
 * so every stored event carries a schema version, and read-side upcasters transform an old shape
 * forward (`v1 → v2 → …`) before `evolve` ever sees it. The registry is active — the
 * `ManualSelectionRequested` v1→v2 transform is registered in {@link buildUpcasterRegistry} — so a
 * schema change is a localized, tested upcaster rather than a migration, exactly the ES form of the
 * no-breaking-change policy.
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
  /** The stored tokens this registry has steps for — the seam's tests assert they are real. */
  registeredTypes(): readonly string[] {
    return this.upcasters.keys().toArray();
  }

  register(type: string, fromVersion: number, upcaster: Upcaster): this {
    const forType = this.upcasters.get(type) ?? new Map<number, Upcaster>();
    forType.set(fromVersion, upcaster);
    this.upcasters.set(type, forType);
    return this;
  }

  /**
   * Apply every registered step at or above the stored version, in ascending order. The schema
   * version is a STORE-WIDE counter, so a type's chain is expected non-contiguous — it skips the
   * versions it did not participate in, and the absence of a step at a version IS the declaration
   * that the type's shape did not change there. That makes this walk total: with no steps
   * registered for the type (or none at/above the stored version — including a future writer's
   * stamp), the payload is declared already-current and passes through untouched. The remaining
   * authoring risk — a shape change nobody wrote a step for — is indistinguishable from
   * no-change-by-declaration at read time; it is guarded where it can be: the contract tier
   * replays frozen legacy fixtures through the production registry.
   */
  upcast(type: string, schemaVersion: number, data: Record<string, unknown>): DownloadEvent {
    const forType = this.upcasters.get(type);
    if (forType === undefined) return data as unknown as DownloadEvent;

    const steps = forType
      .entries()
      .filter(([from]) => from >= schemaVersion)
      .toArray()
      .toSorted(([a], [b]) => a - b);
    let current = data;
    for (const [, step] of steps) current = step(current);
    return current as unknown as DownloadEvent;
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

/** Exposes a registry's keys so the storage-token seam can verify they are stored tokens. */
export function registeredUpcasterTypes(registry: UpcasterRegistry): readonly string[] {
  return registry.registeredTypes();
}

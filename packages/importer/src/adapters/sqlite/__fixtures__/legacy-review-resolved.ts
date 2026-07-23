/**
 * The importer's earlier resolution vocabulary, retained ONLY as upcaster / legacy-tolerance test
 * input. A stored v1 `ReviewResolved` carried the downloader's action verb before the rename to the
 * importer's own `reject-unusable-delivery`; the v1→v2 upcaster lifts it on read. This fixture is
 * the single intentional survivor of the old token in the codebase — every "current behaviour" test
 * speaks the new verb, and only the tests that prove legacy rows still read import from here.
 */
export const LEGACY_UNUSABLE_DELIVERY_VERB = 'reject-and-retry-download';

/** A stored v1 `ReviewResolved` payload (raw JSON shape) carrying the pre-rename verb. */
export function legacyRejectResolvedData(
  reasons: readonly string[] = ['corrupt rip'],
): Record<string, unknown> {
  return { type: 'ReviewResolved', resolution: { kind: LEGACY_UNUSABLE_DELIVERY_VERB, reasons } };
}

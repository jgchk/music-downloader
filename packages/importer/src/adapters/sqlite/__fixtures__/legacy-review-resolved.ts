/**
 * The importer's earlier resolution vocabulary, retained ONLY as upcaster / legacy-tolerance test
 * input. A stored v1 `ReviewResolved` carried the downloader's action verb before the rename to the
 * importer's own `reject-unusable-delivery`; the v1→v2 upcaster lifts it on read. This fixture is
 * the single place the old token survives as a *test-fixture value* — every "current behaviour"
 * test speaks the new verb, and only the tests that prove legacy rows still read import from here.
 * (The upcaster that detects the token, `reviewResolvedV1ToV2`, necessarily names it too — it is a
 * production tolerant reader, so it cannot import this test fixture.)
 */
export const LEGACY_REJECT_VERB = 'reject-and-retry-download';

/** A stored v1 `ReviewResolved` payload (raw JSON shape) carrying the pre-rename verb. */
export function legacyRejectResolvedData(
  reasons: readonly string[] = ['corrupt rip'],
): Record<string, unknown> {
  return { type: 'ReviewResolved', resolution: { kind: LEGACY_REJECT_VERB, reasons } };
}

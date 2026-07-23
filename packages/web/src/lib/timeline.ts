import type { AcquisitionStatusResponseDto } from '@music/downloader';
import type { ImportStatusResponseDto } from '@music/importer';

/**
 * The download-through-import timeline: the web layer composes an acquisition's two histories —
 * the downloader's own steps and, once it was handed off, the importer's — into one list ordered
 * by occurrence time (web-ui spec). This is a web-owned join over the two module facades' read
 * models; it introduces no contract between the bounded contexts (the same principle as the
 * attention queue). Each entry keeps its originating module so the view can attribute it.
 */

export type DownloaderHistoryEntry = AcquisitionStatusResponseDto['history'][number];
export type ImporterHistoryEntry = ImportStatusResponseDto['history'][number];

export type TimelineEntry =
  | { readonly module: 'downloader'; readonly at: string; readonly entry: DownloaderHistoryEntry }
  | { readonly module: 'importer'; readonly at: string; readonly entry: ImporterHistoryEntry };

/** The hand-off precedes the import it triggered, so the downloader sorts first at an equal time. */
const moduleRank = (module: TimelineEntry['module']): number => (module === 'downloader' ? 0 : 1);

/**
 * Merge the two histories and order them by `at` (ISO-8601, lexicographically comparable). Ordering
 * by occurrence time is what interleaves the two contexts: an import rejection, for instance, sorts
 * between the downloader's hand-off and its subsequent revival rather than the importer's steps
 * showing as one block after all of the downloader's. The tie-break only decides an exact-timestamp
 * collision — the downloader's hand-off sorts ahead of the import it triggered — and same-module,
 * same-time entries keep their log order because `Array.prototype.sort` is stable (ES2019+).
 */
export function mergeTimeline(
  downloader: readonly DownloaderHistoryEntry[],
  importer: readonly ImporterHistoryEntry[],
): TimelineEntry[] {
  const tagged: TimelineEntry[] = [
    ...downloader.map((entry): TimelineEntry => ({ module: 'downloader', at: entry.at, entry })),
    ...importer.map((entry): TimelineEntry => ({ module: 'importer', at: entry.at, entry })),
  ];
  tagged.sort((a, b) => {
    if (a.at !== b.at) return a.at < b.at ? -1 : 1;
    if (a.module !== b.module) return moduleRank(a.module) - moduleRank(b.module);
    return 0;
  });
  return tagged;
}

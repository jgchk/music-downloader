import type { AcquisitionStatusResponseDto } from '@music/downloader';
import type { ImportStatusResponseDto } from '@music/importer';
import { formatBytes } from './acquisitions.js';
import type { BadgePhase } from './phase-label.js';
import type { DownloaderHistoryEntry, ImporterHistoryEntry, TimelineEntry } from './timeline.js';

/**
 * The acquisition detail's copy system — every timeline and status string in one place, written to
 * the register (design D3): completed entries are past-tense verb-led fragments, the pending row is
 * present-progressive, no first person, no internal vocabulary in visible text (enum codes and raw
 * paths live in the per-entry disclosure), numbers human-formatted. Unknown kinds and codes degrade
 * to neutral lines with the raw value in the disclosure — the tolerant reader stays honest.
 */

export type EntryState = 'routine' | 'attention' | 'failure' | 'success';

export interface EntryDetailItem {
  readonly label: string;
  readonly value: string;
}

export interface EntryCopy {
  /** The always-visible line — carries the human account on its own. */
  readonly text: string;
  /** Marker semantics for the skins; never the only signal (the text carries the meaning). */
  readonly state: EntryState;
  /** Diagnostic payload behind the entry's disclosure; empty means no disclosure is rendered. */
  readonly detail: readonly EntryDetailItem[];
  /** A pathway to act, for entries that wait on the user. */
  readonly link?: { readonly href: string; readonly label: string };
}

// --- Glosses -----------------------------------------------------------------------------------

const DOWNLOAD_FAILURE_GLOSS: Readonly<Record<string, string>> = {
  PeerUnavailable: 'the source went offline',
  Stalled: 'the download stalled',
  QueueTimeout: 'it waited too long in the source’s queue',
  TransferError: 'the transfer was cut off',
  FileUnavailable: 'the files were no longer available',
  Cancelled: 'the download was cancelled',
};

const VALIDATION_REASON_GLOSS: Readonly<Record<string, string>> = {
  Unplayable: 'some files were unplayable',
  WrongTrackCount: 'the track count didn’t match the release',
  DurationMismatch: 'track lengths didn’t match the release',
  RecordingMismatch: 'the audio didn’t match the release’s recordings',
  QualityNotAuthentic: 'the audio quality wasn’t what it claimed',
};

const RESOLUTION_GLOSS: Readonly<Record<string, string>> = {
  'apply-candidate': 'you approved the match',
  'supply-id': 'you supplied the release id',
  'refresh-candidates': 'you asked for fresh matches',
  'manual-tags': 'you supplied tags by hand',
  'import-as-is': 'you chose to import the files as they are',
  reject: 'you rejected the import',
  'reject-unusable-delivery': 'you rejected the files. A new download will be tried.',
  accept: 'you accepted it',
};

/** The auto-apply distance inverted to a whole match percentage (extends the v3.8.0 gloss). */
export function matchPercent(distance: number): number {
  return Math.round((1 - distance) * 100);
}

type RequestedEcho = Extract<DownloaderHistoryEntry, { kind: 'requested' }>['request'];

function requestDescription(request: RequestedEcho): string {
  if (request.kind === 'descriptor') {
    return `${request.artist} — ${request.title} (${request.targetType})`;
  }
  const noun =
    request.kind === 'release-group' ? 'MusicBrainz release group' : 'MusicBrainz release';
  return `${noun} ${request.mbid}`;
}

// --- Timeline entry copy -----------------------------------------------------------------------

function downloaderEntryCopy(entry: DownloaderHistoryEntry): EntryCopy | undefined {
  switch (entry.kind) {
    case 'requested': {
      return {
        text: 'Requested',
        state: 'routine',
        detail: [{ label: 'Request', value: requestDescription(entry.request) }],
      };
    }
    case 'resolved': {
      const year = entry.year === undefined ? '' : ` (${entry.year})`;
      return {
        text: `Matched to MusicBrainz — ${entry.artist}, ${entry.title}${year}`,
        state: 'routine',
        detail: [],
      };
    }
    case 'search-started': {
      return entry.round === 1
        ? { text: 'Started searching for a download', state: 'routine', detail: [] }
        : {
            text: 'Searched again for another source',
            state: 'routine',
            detail: [{ label: 'Search round', value: String(entry.round) }],
          };
    }
    case 'selected': {
      return {
        text: `Chose a download from ${entry.candidate.username}`,
        state: 'routine',
        detail: [
          { label: 'Source path', value: entry.candidate.path },
          { label: 'Size', value: formatBytes(entry.candidate.sizeBytes) },
        ],
      };
    }
    case 'download-failed': {
      const gloss = DOWNLOAD_FAILURE_GLOSS[entry.reason];
      return {
        text:
          gloss === undefined
            ? 'Download failed — trying the next source.'
            : `Download failed — ${gloss}. Trying the next source.`,
        state: 'failure',
        detail: [
          { label: 'Reason code', value: entry.reason },
          { label: 'Source path', value: entry.candidate.path },
        ],
      };
    }
    case 'validation-failed': {
      const glosses = entry.reasons.map((reason) => VALIDATION_REASON_GLOSS[reason] ?? reason);
      return {
        text: `The files failed quality checks — ${glosses.join('; ')}. Trying the next source.`,
        state: 'failure',
        detail: [
          { label: 'Reason codes', value: entry.reasons.join(', ') },
          { label: 'Source path', value: entry.candidate.path },
        ],
      };
    }
    case 'imported': {
      return {
        text: 'Download complete — preparing to add to the library',
        state: 'routine',
        detail: [{ label: 'Delivered to', value: entry.location }],
      };
    }
    case 'fulfillment-rejected': {
      return {
        text: `Delivery rejected — ${entry.reasons.join('; ')}. Searching for a replacement.`,
        state: 'failure',
        detail: [{ label: 'Reasons', value: entry.reasons.join(', ') }],
      };
    }
    case 'fulfilled': {
      // Co-emitted with the hand-off (the staging deposit), so it duplicates the `imported` entry's
      // moment; the true happy ending is the import's `applied`. Curated out of the view — the
      // facade still carries the fact.
      return undefined;
    }
    case 'exhausted': {
      return {
        text: 'Gave up — every source failed or came up empty. Request it again to search anew.',
        state: 'failure',
        detail: [],
      };
    }
    case 'conflicted': {
      return {
        text: 'Stopped — the destination already had files for this release. Nothing was overwritten.',
        state: 'failure',
        detail: [{ label: 'Occupied location', value: entry.location }],
      };
    }
    case 'metadata-failed': {
      return {
        text: 'Couldn’t identify this release. Check the artist and title, then request it again.',
        state: 'failure',
        detail: [],
      };
    }
    case 'cancelled': {
      return { text: 'Cancelled', state: 'routine', detail: [] };
    }
    default: {
      // Tolerant reader: a downloader history kind added later lands here rather than mislabeling.
      return {
        text: 'Something happened that this page can’t describe yet',
        state: 'routine',
        detail: [],
      };
    }
  }
}

function importerEntryCopy(entry: ImporterHistoryEntry): EntryCopy | undefined {
  switch (entry.kind) {
    case 'requested': {
      return { text: 'Import started', state: 'routine', detail: [] };
    }
    case 'proposed': {
      const plural = entry.candidateCount === 1 ? '' : 'es';
      return {
        text: `Compared against the library — ${entry.candidateCount} candidate match${plural}`,
        state: 'routine',
        detail: [],
      };
    }
    case 'auto-apply-selected': {
      return {
        text: `Confident match — importing automatically (${matchPercent(entry.distance)}% match)`,
        state: 'routine',
        detail: [{ label: 'Match distance', value: String(entry.distance) }],
      };
    }
    case 'review-required': {
      return {
        text: 'Needs your review',
        state: 'attention',
        detail: [{ label: 'Review kind', value: entry.reviewKind }],
        link: { href: '/reviews', label: 'Open the review' },
      };
    }
    case 'review-resolved': {
      const gloss = RESOLUTION_GLOSS[entry.resolution];
      return gloss === undefined
        ? {
            text: 'Review resolved',
            state: 'routine',
            detail: [{ label: 'Resolution', value: entry.resolution }],
          }
        : { text: `Review resolved — ${gloss}`, state: 'routine', detail: [] };
    }
    case 'applied': {
      return {
        text: 'Added to the library',
        state: 'success',
        detail: [{ label: 'Library location', value: entry.location }],
      };
    }
    case 'remediation-required': {
      return {
        text: 'Added to the library, but needs attention',
        state: 'attention',
        detail: entry.failures.map((failure) => ({ label: failure.stage, value: failure.message })),
      };
    }
    case 'rejected': {
      return {
        text: `Import rejected — ${entry.reason}. A new download will be tried.`,
        state: 'failure',
        detail: [],
      };
    }
    case 'release-verdict-recorded': {
      return {
        text: 'Marked this delivery unusable — retrying the download',
        state: 'routine',
        detail: [{ label: 'Reasons', value: entry.reasons.join(', ') }],
      };
    }
    default: {
      // Tolerant reader: an importer history kind added later lands here safely.
      return {
        text: 'Something happened during import that this page can’t describe yet',
        state: 'routine',
        detail: [],
      };
    }
  }
}

/**
 * The visible copy for one timeline entry, in the unified narrator voice — the originating module
 * shapes the wording, never appears in it. `undefined` means the entry is curated out of the view.
 */
export function entryCopy(item: TimelineEntry): EntryCopy | undefined {
  return item.module === 'downloader'
    ? downloaderEntryCopy(item.entry)
    : importerEntryCopy(item.entry);
}

// --- Status line -------------------------------------------------------------------------------

export interface OverallStatus {
  readonly tone: BadgePhase;
  readonly phrase: string;
}

const IMPORT_TERMINAL = new Set(['applied', 'rejected']);

/** Whether the import side has settled (or never existed), so nothing more is coming. */
export function isImportSettled(
  importState: 'present' | 'none' | 'unavailable',
  importStatus?: ImportStatusResponseDto,
): boolean {
  return importState !== 'present' || importStatus === undefined
    ? true
    : IMPORT_TERMINAL.has(importStatus.status);
}

const STATUS_PHRASE: Readonly<Record<AcquisitionStatusResponseDto['status'], string>> = {
  Empty: 'Starting',
  Pending: 'Identifying the release',
  AwaitingManualSelection: 'Waiting for an edition choice',
  Searching: 'Searching',
  Selecting: 'Choosing a source',
  Downloading: 'Downloading',
  Validating: 'Checking quality',
  Importing: 'Adding to the library',
  Fulfilled: 'In your library',
  Exhausted: 'No usable download found',
  Cancelled: 'Cancelled',
  MetadataFailed: 'Couldn’t identify the release',
  Conflicted: 'Stopped — destination occupied',
};

const STATUS_TONE: Readonly<Record<AcquisitionStatusResponseDto['status'], BadgePhase>> = {
  Empty: 'pending',
  Pending: 'pending',
  AwaitingManualSelection: 'attention',
  Searching: 'pending',
  Selecting: 'pending',
  Downloading: 'pending',
  Validating: 'pending',
  Importing: 'pending',
  Fulfilled: 'fulfilled',
  Exhausted: 'failed',
  Cancelled: 'failed',
  MetadataFailed: 'failed',
  Conflicted: 'failed',
};

/** The human phrase for a downloader status on its own (the queue list, which has no import read). */
export function statusPhrase(status: AcquisitionStatusResponseDto['status']): string {
  return STATUS_PHRASE[status];
}

/**
 * The page's one status account, honest across both halves of the story: while a delivered
 * acquisition's import is still working, the phrase follows the import (a "Fulfilled" enum would
 * claim a library the files haven't reached); once everything settles, the ending speaks.
 */
export function overallStatus(
  acquisition: AcquisitionStatusResponseDto,
  importState: 'present' | 'none' | 'unavailable',
  importStatus?: ImportStatusResponseDto,
): OverallStatus {
  if (
    importStatus !== undefined &&
    importState === 'present' &&
    acquisition.status === 'Fulfilled'
  ) {
    switch (importStatus.status) {
      case 'awaiting-review': {
        return { tone: 'attention', phrase: 'Waiting for your review' };
      }
      case 'applying': {
        return { tone: 'pending', phrase: 'Adding to the library' };
      }
      case 'applied': {
        return { tone: 'fulfilled', phrase: 'In your library' };
      }
      case 'rejected': {
        return { tone: 'failed', phrase: 'Import rejected' };
      }
      default: {
        return { tone: 'pending', phrase: 'Matching against the library' };
      }
    }
  }
  return { tone: STATUS_TONE[acquisition.status], phrase: STATUS_PHRASE[acquisition.status] };
}

/** Correctly-pluralized counters with zero-count segments omitted (design D9). */
export function metaSummary(attempts: number, rejectedCount: number): string {
  const parts: string[] = [];
  if (attempts > 0) parts.push(`${attempts} attempt${attempts === 1 ? '' : 's'}`);
  if (rejectedCount > 0) {
    parts.push(`${rejectedCount} source${rejectedCount === 1 ? '' : 's'} rejected`);
  }
  return parts.join(' · ');
}

// --- The synthesized in-progress row (design D5) -----------------------------------------------

export interface PendingRow {
  readonly text: string;
  readonly state: 'pending' | 'attention';
  readonly link?: { readonly href: string; readonly label: string };
  /** Whether live download progress belongs inside this row. */
  readonly showProgress: boolean;
}

/**
 * Exactly one in-progress row while the story is unsettled, derived from the status read models the
 * page already loads (never a new wire contract). Downloader-active phases win (a revival returns
 * here); after delivery the import's phase speaks; a settled story has no pending row — its closing
 * entry ends it.
 */
export function pendingRowFor(
  acquisition: AcquisitionStatusResponseDto,
  importState: 'present' | 'none' | 'unavailable',
  importStatus?: ImportStatusResponseDto,
): PendingRow | undefined {
  if (acquisition.cancellable === true) {
    switch (acquisition.status) {
      case 'AwaitingManualSelection': {
        return {
          text: 'Waiting for you to choose an edition',
          state: 'attention',
          showProgress: false,
        };
      }
      case 'Downloading': {
        const from = acquisition.currentCandidate?.username;
        return {
          text: from === undefined ? 'Downloading…' : `Downloading from ${from}…`,
          state: 'pending',
          showProgress: true,
        };
      }
      case 'Validating': {
        return { text: 'Checking audio quality…', state: 'pending', showProgress: false };
      }
      case 'Importing': {
        return { text: 'Adding to the library…', state: 'pending', showProgress: false };
      }
      case 'Searching':
      case 'Selecting': {
        return { text: 'Searching for a download…', state: 'pending', showProgress: false };
      }
      default: {
        return { text: 'Identifying the release…', state: 'pending', showProgress: false };
      }
    }
  }
  if (
    importStatus !== undefined &&
    importState === 'present' &&
    acquisition.status === 'Fulfilled' &&
    !IMPORT_TERMINAL.has(importStatus.status)
  ) {
    if (importStatus.status === 'awaiting-review') {
      return {
        text: 'Waiting for your review',
        state: 'attention',
        link: { href: '/reviews', label: 'Open the review' },
        showProgress: false,
      };
    }
    if (importStatus.status === 'applying') {
      return { text: 'Adding to the library…', state: 'pending', showProgress: false };
    }
    return { text: 'Matching against the library…', state: 'pending', showProgress: false };
  }
  return undefined;
}

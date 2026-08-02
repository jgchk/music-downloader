import type { AcquisitionStatusResponseDto } from '@music/downloader';
import { formatBytes, isTerminal, statusTone } from './acquisitions.js';
import type { BadgePhase } from './phase-label.js';
import type {
  DownloaderHistoryEntry,
  ImporterHistoryEntry,
  ImportSection,
  TimelineEntry,
} from './timeline.js';

/**
 * The acquisition detail's copy system — every timeline and status string in one place, written to
 * the register (design D3): completed entries are past-tense verb-led fragments, the pending row is
 * present-progressive, no first person, no internal vocabulary in visible text (enum codes and raw
 * paths live in the per-entry disclosure), numbers human-formatted. Unknown kinds and codes degrade
 * to neutral lines with the raw value in the disclosure — the tolerant reader stays honest, and
 * every closed union is matched exhaustively so a new kind, code, or phase is a compile error
 * demanding its copy before it can ship.
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

type DownloadFailureReason = Extract<DownloaderHistoryEntry, { kind: 'download-failed' }>['reason'];
type ValidationReason = Extract<
  DownloaderHistoryEntry,
  { kind: 'validation-failed' }
>['reasons'][number];
type ResolutionVerb = Extract<ImporterHistoryEntry, { kind: 'review-resolved' }>['resolution'];

// `satisfies` keeps each map total over its wire enum — a new code is a compile error demanding a
// gloss — while lookups widen to `Partial<Record<string, string>>` so a runtime value from beyond
// the compiled enum still degrades to the honest generic line instead of crashing.
const DOWNLOAD_FAILURE_GLOSS = {
  PeerUnavailable: 'the source went offline',
  Stalled: 'the download stalled',
  QueueTimeout: 'it waited too long in the source’s queue',
  TransferError: 'the transfer was cut off',
  FileUnavailable: 'the files were no longer available',
  Cancelled: 'the download was cancelled',
} satisfies Record<DownloadFailureReason, string>;

const VALIDATION_REASON_GLOSS = {
  Unplayable: 'some files were unplayable',
  WrongTrackCount: 'the track count didn’t match the release',
  DurationMismatch: 'track lengths didn’t match the release',
  RecordingMismatch: 'the audio didn’t match the release’s recordings',
  QualityNotAuthentic: 'the audio quality wasn’t what it claimed',
} satisfies Record<ValidationReason, string>;

const RESOLUTION_GLOSS = {
  'apply-candidate': 'you approved the match',
  'supply-id': 'you supplied the release id',
  'refresh-candidates': 'you asked for fresh matches',
  'manual-tags': 'you supplied tags by hand',
  'import-as-is': 'you chose to import the files as they are',
  reject: 'you rejected the import',
  'retry-enrichment': 'you asked for the release data to be fetched again',
  'reject-unusable-delivery': 'you rejected the files. A new download may be tried.',
  accept: 'you accepted it',
} satisfies Record<ResolutionVerb, string>;

function glossOf(map: Record<string, string>, code: string): string | undefined {
  return (map as Partial<Record<string, string>>)[code];
}

/** The auto-apply distance inverted to a whole match percentage (extends the v3.8.0 gloss). */
export function matchPercent(distance: number): number {
  return Math.round((1 - distance) * 100);
}

type RequestedEcho = Extract<DownloaderHistoryEntry, { kind: 'requested' }>['request'];

function requestDescription(request: RequestedEcho): string {
  if (request.kind === 'descriptor') {
    const album = request.album === undefined ? '' : `, from ${request.album}`;
    return `${request.artist} — ${request.title} (${request.targetType}${album})`;
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
      const gloss = glossOf(DOWNLOAD_FAILURE_GLOSS, entry.reason);
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
      const glosses = entry.reasons.map(
        (reason) => glossOf(VALIDATION_REASON_GLOSS, reason) ?? reason,
      );
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
      // Exhaustiveness: a new history kind is a compile error here (`satisfies never`) so its copy
      // must exist before the build passes. At runtime the arm still degrades honestly — with the
      // raw kind traced in the disclosure — for data this compiled page cannot know.
      entry satisfies never;
      return unknownEntryCopy('Something happened that this page can’t describe yet', entry);
    }
  }
}

function unknownEntryCopy(text: string, entry: unknown): EntryCopy {
  return {
    text,
    state: 'routine',
    detail: [{ label: 'Event kind', value: String((entry as { kind?: unknown }).kind) }],
  };
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
      const gloss = glossOf(RESOLUTION_GLOSS, entry.resolution);
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
        link: { href: '/reviews', label: 'Open the review' },
      };
    }
    case 'rejected': {
      return {
        text: `Import rejected — ${entry.reason}. A new download may be tried.`,
        state: 'failure',
        detail: [],
      };
    }
    case 'release-verdict-recorded': {
      return {
        text: 'Marked this delivery unusable — a new download may be tried',
        state: 'routine',
        detail: [{ label: 'Reasons', value: entry.reasons.join(', ') }],
      };
    }
    default: {
      // Same regime as the downloader switch: compile pressure plus a traced runtime degrade.
      entry satisfies never;
      return unknownEntryCopy(
        'Something happened during import that this page can’t describe yet',
        entry,
      );
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

/**
 * Whether the whole story — download and import — has settled, so the page may rest (no pending
 * row, no refresh, the closing entry carries the duration). A failed downloader ending needs no
 * import; a delivery (`Fulfilled`) is settled only once its import reports its own decided
 * settledness — the import is created asynchronously after the hand-off, so an absent or
 * unavailable import read on a delivered acquisition means "keep watching", never "done".
 */
export function isStorySettled(
  acquisition: AcquisitionStatusResponseDto,
  importSection: ImportSection,
): boolean {
  if (!isTerminal(acquisition)) return false;
  if (acquisition.status !== 'Fulfilled') return true;
  if (importSection.state !== 'present') return false;
  // A rejected import is terminal on the importer's side, yet the downloader may consume the
  // verdict moments later and revive the acquisition (Fulfilled is stable-but-defeasible). That
  // cross-context race is the BFF's to sequence — the import's own settled flag cannot express
  // it — so a rejection keeps the page watching; a plain no-retry rejection then merely polls
  // while its page is open, the same accepted cost as a legacy delivery.
  return importSection.status.settled === true && importSection.status.status !== 'rejected';
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
  MetadataFailed: 'Couldn\u{2019}t identify the release',
  Conflicted: 'Stopped \u{2014} destination occupied',
};

/** The human phrase for a downloader status on its own (the queue list, which has no import read). */
export function statusPhrase(status: AcquisitionStatusResponseDto['status']): string {
  return STATUS_PHRASE[status];
}

/**
 * The page's one status account, honest across both halves of the story: a delivered acquisition
 * speaks with its import's voice — including the async window where the import does not exist yet
 * (or its read failed), which must never be presented as "in your library". Tones reuse the list's
 * own `statusTone` map so the two surfaces cannot drift. The import-phase switch is exhaustive: a
 * new phase is a compile error demanding its phrase.
 */
export function overallStatus(
  acquisition: AcquisitionStatusResponseDto,
  importSection: ImportSection,
): OverallStatus {
  if (acquisition.status === 'Fulfilled') {
    switch (importSection.state) {
      case 'none': {
        return { tone: 'pending', phrase: 'Delivered \u{2014} confirming the import' };
      }
      case 'unavailable': {
        return { tone: 'pending', phrase: 'Delivered \u{2014} import status unavailable' };
      }
      case 'present': {
        switch (importSection.status.status) {
          case 'empty':
          case 'requested':
          case 'proposing': {
            return { tone: 'pending', phrase: 'Matching against the library' };
          }
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
            // Physically unreachable in-process (closed enum), but a drifted runtime value must
            // degrade to the honest unconfirmed claim — never fall through to "In your library".
            importSection.status.status satisfies never;
            return { tone: 'pending', phrase: 'Delivered \u{2014} confirming the import' };
          }
        }
      }
    }
  }
  return { tone: statusTone(acquisition.status), phrase: STATUS_PHRASE[acquisition.status] };
}

/** Correctly-pluralized counters with zero-count segments omitted (design D9). */
export function metaSummary(attempts: number, rejectedCount: number): string {
  const parts: string[] = [];
  if (attempts > 0) parts.push(`${attempts} attempt${attempts === 1 ? '' : 's'}`);
  if (rejectedCount > 0) {
    parts.push(`${rejectedCount} source${rejectedCount === 1 ? '' : 's'} rejected`);
  }
  return parts.join(' \u{B7} ');
}

// --- The synthesized in-progress row (design D5) -----------------------------------------------

export type PendingState = 'pending' | 'attention';

export interface PendingRow {
  readonly text: string;
  readonly state: PendingState;
  readonly link?: { readonly href: string; readonly label: string };
  /** Whether live download progress belongs inside this row. */
  readonly showProgress: boolean;
}

const SEARCHING_ROW: PendingRow = {
  text: 'Searching for a download\u{2026}',
  state: 'pending',
  showProgress: false,
};

const ADDING_ROW: PendingRow = {
  text: 'Adding to the library\u{2026}',
  state: 'pending',
  showProgress: false,
};

/**
 * Exactly one in-progress row while the story is unsettled, derived from the status read models
 * the page already loads (never a new wire contract). Liveness gates on the decided terminality
 * (`isTerminal`), NOT the cancel affordance, so an older producer omitting `cancellable` still
 * narrates. Both inner switches are exhaustive: a new downloader status or importer phase is a
 * compile error demanding a row (or an explicit "no row").
 */
export function pendingRowFor(
  acquisition: AcquisitionStatusResponseDto,
  importSection: ImportSection,
): PendingRow | undefined {
  if (!isTerminal(acquisition)) {
    switch (acquisition.status) {
      case 'Empty':
      case 'Pending': {
        return { text: 'Identifying the release\u{2026}', state: 'pending', showProgress: false };
      }
      case 'AwaitingManualSelection': {
        return {
          text: 'Waiting for you to choose an edition',
          state: 'attention',
          showProgress: false,
        };
      }
      case 'Searching':
      case 'Selecting': {
        return SEARCHING_ROW;
      }
      case 'Downloading': {
        const from = acquisition.currentCandidate?.username;
        return {
          text: from === undefined ? 'Downloading\u{2026}' : `Downloading from ${from}\u{2026}`,
          state: 'pending',
          showProgress: true,
        };
      }
      case 'Validating': {
        return { text: 'Checking audio quality\u{2026}', state: 'pending', showProgress: false };
      }
      case 'Importing': {
        return ADDING_ROW;
      }
      case 'Fulfilled':
      case 'Exhausted':
      case 'Cancelled':
      case 'MetadataFailed':
      case 'Conflicted': {
        // The enum says terminal while the decided flag says otherwise (an absent flag, or a
        // drifted producer): claim nothing rather than narrate a phase that is over.
        return undefined;
      }
    }
  }
  if (acquisition.status !== 'Fulfilled') return undefined;
  switch (importSection.state) {
    case 'none':
    case 'unavailable': {
      // The importer picks the delivery up asynchronously; keep narrating (and let the page poll)
      // instead of presenting the async gap as a finished story.
      return ADDING_ROW;
    }
    case 'present': {
      switch (importSection.status.status) {
        case 'empty':
        case 'requested':
        case 'proposing': {
          return {
            text: 'Matching against the library\u{2026}',
            state: 'pending',
            showProgress: false,
          };
        }
        case 'awaiting-review': {
          return {
            text: 'Waiting for your review',
            state: 'attention',
            link: { href: '/reviews', label: 'Open the review' },
            showProgress: false,
          };
        }
        case 'applying': {
          return ADDING_ROW;
        }
        case 'applied':
        case 'rejected': {
          return undefined;
        }
        default: {
          // Same regime as overallStatus: a drifted phase keeps the honest narration.
          importSection.status.status satisfies never;
          return ADDING_ROW;
        }
      }
    }
  }
}

import { describe, expect, it } from 'vitest';
import { historyEntrySchema, type AcquisitionStatusResponseDto } from '@music/downloader';
import {
  historyEntrySchema as importerHistoryEntrySchema,
  type ImportStatusResponseDto,
} from '@music/importer';
import {
  entryCopy,
  isStorySettled,
  matchPercent,
  metaSummary,
  overallStatus,
  pendingRowFor,
  statusPhrase,
} from './copy.js';
import type {
  DownloaderHistoryEntry,
  ImporterHistoryEntry,
  ImportSection,
  TimelineEntry,
} from './timeline.js';

const candidate = {
  username: 'xronin',
  path: String.raw`@@ygcrs\MUSIC\RAM (2013)`,
  sizeBytes: 900_000_000,
};

const AT = '2026-08-01T10:00:00Z';

/** Omit distributed over each union member, so builders keep per-variant excess-property checks. */
type EachWithoutAt<T> = T extends unknown ? Omit<T, 'at'> & { at?: string } : never;

function dl(entry: EachWithoutAt<DownloaderHistoryEntry>): TimelineEntry {
  const at = entry.at ?? AT;
  return { module: 'downloader', at, entry: { ...entry, at } };
}

function im(entry: EachWithoutAt<ImporterHistoryEntry>): TimelineEntry {
  const at = entry.at ?? AT;
  return { module: 'importer', at, entry: { ...entry, at } };
}

function acquisition(
  overrides: Partial<AcquisitionStatusResponseDto>,
): AcquisitionStatusResponseDto {
  return {
    acquisitionId: 'acq-1',
    status: 'Searching',
    attempts: 0,
    rejectedCount: 0,
    history: [],
    cancellable: true,
    awaitingSelection: false,
    ...overrides,
  };
}

const NO_IMPORT: ImportSection = { state: 'none' };
const IMPORT_UNAVAILABLE: ImportSection = { state: 'unavailable' };

function importPresent(overrides: Partial<ImportStatusResponseDto>): ImportSection {
  return {
    state: 'present',
    status: {
      importId: 'imp-1',
      status: 'requested',
      settled: false,
      history: [],
      ...overrides,
    },
  };
}

describe('entryCopy — downloader entries', () => {
  it('renders the request as a plain requested line with the request in the disclosure', () => {
    const copy = entryCopy(
      dl({
        kind: 'requested',
        request: {
          kind: 'descriptor',
          targetType: 'album',
          artist: 'Willie Nelson',
          title: 'Red Headed Stranger',
        },
      }),
    );
    expect(copy?.text).toBe('Requested');
    expect(copy?.state).toBe('routine');
    expect(copy?.detail).toEqual([
      { label: 'Request', value: 'Willie Nelson — Red Headed Stranger (album)' },
    ]);
  });

  it('carries a track descriptor’s disambiguating album into the request disclosure', () => {
    const copy = entryCopy(
      dl({
        kind: 'requested',
        request: {
          kind: 'descriptor',
          targetType: 'track',
          artist: 'Nick Drake',
          title: 'Pink Moon',
          album: 'Pink Moon',
        },
      }),
    );
    expect(copy?.detail).toEqual([
      { label: 'Request', value: 'Nick Drake — Pink Moon (track, from Pink Moon)' },
    ]);
  });

  it('describes an id request in the disclosure by its id', () => {
    const group = entryCopy(
      dl({
        kind: 'requested',
        request: { kind: 'release-group', targetType: 'album', mbid: 'rg-123' },
      }),
    );
    expect(group?.detail).toEqual([
      { label: 'Request', value: 'MusicBrainz release group rg-123' },
    ]);
    const release = entryCopy(
      dl({
        kind: 'requested',
        request: { kind: 'musicbrainz', targetType: 'album', mbid: 'm-123' },
      }),
    );
    expect(release?.detail).toEqual([{ label: 'Request', value: 'MusicBrainz release m-123' }]);
  });

  it('renders resolution with the release identity and year', () => {
    const copy = entryCopy(
      dl({ kind: 'resolved', artist: 'Willie Nelson', title: 'Red Headed Stranger', year: 1975 }),
    );
    expect(copy?.text).toBe('Matched to MusicBrainz — Willie Nelson, Red Headed Stranger (1975)');
    expect(copy?.detail).toEqual([]);
  });

  it('renders resolution without a year when none is known', () => {
    expect(entryCopy(dl({ kind: 'resolved', artist: 'A', title: 'T' }))?.text).toBe(
      'Matched to MusicBrainz — A, T',
    );
  });

  it('renders the first search round as the search starting', () => {
    const copy = entryCopy(dl({ kind: 'search-started', round: 1 }));
    expect(copy?.text).toBe('Started searching for a download');
    expect(copy?.detail).toEqual([]);
  });

  it('renders a later search round as searching again, with the round in the disclosure', () => {
    const copy = entryCopy(dl({ kind: 'search-started', round: 3 }));
    expect(copy?.text).toBe('Searched again for another source');
    expect(copy?.detail).toEqual([{ label: 'Search round', value: '3' }]);
  });

  it('renders a selection with the source inline and the path in the disclosure', () => {
    const copy = entryCopy(dl({ kind: 'selected', candidate }));
    expect(copy?.text).toBe('Chose a download from xronin');
    expect(copy?.detail).toEqual([
      { label: 'Source path', value: String.raw`@@ygcrs\MUSIC\RAM (2013)` },
      { label: 'Size', value: '858.3 MiB' },
    ]);
  });

  it('renders a download start as the transfer beginning, with the path in the disclosure', () => {
    const copy = entryCopy(dl({ kind: 'download-started', candidate }));
    expect(copy?.text).toBe('Downloading from xronin');
    expect(copy?.state).toBe('routine');
    expect(copy?.detail).toEqual([
      { label: 'Source path', value: String.raw`@@ygcrs\MUSIC\RAM (2013)` },
    ]);
  });

  it('glosses a known download-failure reason and keeps the code in the disclosure', () => {
    const copy = entryCopy(dl({ kind: 'download-failed', candidate, reason: 'TransferError' }));
    expect(copy?.text).toBe('Download failed — the transfer was cut off. Trying the next source.');
    expect(copy?.state).toBe('failure');
    expect(copy?.detail).toEqual([
      { label: 'Reason code', value: 'TransferError' },
      { label: 'Source path', value: String.raw`@@ygcrs\MUSIC\RAM (2013)` },
    ]);
  });

  it('degrades an unmapped download-failure reason to the generic line with the code in the disclosure', () => {
    const copy = entryCopy(
      dl({ kind: 'download-failed', candidate, reason: 'SomethingNew' as never }),
    );
    expect(copy?.text).toBe('Download failed — trying the next source.');
    expect(copy?.detail[0]).toEqual({ label: 'Reason code', value: 'SomethingNew' });
  });

  it('glosses validation failures and keeps the raw reasons in the disclosure', () => {
    const copy = entryCopy(
      dl({ kind: 'validation-failed', candidate, reasons: ['Unplayable', 'DurationMismatch'] }),
    );
    expect(copy?.text).toBe(
      'The files failed quality checks — some files were unplayable; track lengths didn’t match the release. Trying the next source.',
    );
    expect(copy?.state).toBe('failure');
    expect(copy?.detail[0]).toEqual({
      label: 'Reason codes',
      value: 'Unplayable, DurationMismatch',
    });
  });

  it('carries an unmapped validation reason verbatim in the gloss slot (tolerant reader)', () => {
    const copy = entryCopy(
      dl({ kind: 'validation-failed', candidate, reasons: ['SomethingNew' as never] }),
    );
    expect(copy?.text).toBe(
      'The files failed quality checks — SomethingNew. Trying the next source.',
    );
  });

  it('renders the hand-off without naming the importer', () => {
    const copy = entryCopy(dl({ kind: 'imported', candidate, location: '/staging/a' }));
    expect(copy?.text).toBe('Download complete — preparing to add to the library');
    expect(copy?.detail).toEqual([{ label: 'Delivered to', value: '/staging/a' }]);
  });

  it('renders a delivery rejection with its reasons and the next step', () => {
    const copy = entryCopy(
      dl({ kind: 'fulfillment-rejected', candidate, reasons: ['corrupt stub'] }),
    );
    expect(copy?.text).toBe('Delivery rejected — corrupt stub. Searching for a replacement.');
    expect(copy?.state).toBe('failure');
  });

  it('suppresses the downloader fulfilled entry (the hand-off already covers that moment)', () => {
    expect(entryCopy(dl({ kind: 'fulfilled', location: '/staging/a' }))).toBeUndefined();
  });

  it('ends an exhausted story with the reason and a remediation hint', () => {
    const copy = entryCopy(dl({ kind: 'exhausted' }));
    expect(copy?.text).toBe(
      'Gave up — every source failed or came up empty. Request it again to search anew.',
    );
    expect(copy?.state).toBe('failure');
  });

  it('describes a conflict as an occupied destination, nothing overwritten', () => {
    const copy = entryCopy(dl({ kind: 'conflicted', location: '/lib/occupied' }));
    expect(copy?.text).toBe(
      'Stopped — the destination already had files for this release. Nothing was overwritten.',
    );
    expect(copy?.detail).toEqual([{ label: 'Occupied location', value: '/lib/occupied' }]);
  });

  it('ends a failed resolution with a check-and-retry hint', () => {
    const copy = entryCopy(dl({ kind: 'metadata-failed' }));
    expect(copy?.text).toBe(
      'Couldn’t identify this release. Check the artist and title, then request it again.',
    );
    expect(copy?.state).toBe('failure');
  });

  it('renders a cancellation plainly', () => {
    const copy = entryCopy(dl({ kind: 'cancelled' }));
    expect(copy?.text).toBe('Cancelled');
    expect(copy?.state).toBe('routine');
  });

  it('renders an unknown downloader kind through the traced tolerant fallback', () => {
    const copy = entryCopy(dl({ kind: 'brand-new-kind' } as never));
    expect(copy?.text).toBe('Something happened that this page can’t describe yet');
    expect(copy?.state).toBe('routine');
    expect(copy?.detail).toEqual([{ label: 'Event kind', value: 'brand-new-kind' }]);
  });
});

describe('entryCopy — importer entries (no module prefix, unified voice)', () => {
  it('renders the import start without stuttering', () => {
    expect(entryCopy(im({ kind: 'requested' }))?.text).toBe('Import started');
  });

  it('pluralizes the candidate comparison', () => {
    expect(entryCopy(im({ kind: 'proposed', candidateCount: 1 }))?.text).toBe(
      'Compared against the library — 1 candidate match',
    );
    expect(entryCopy(im({ kind: 'proposed', candidateCount: 3 }))?.text).toBe(
      'Compared against the library — 3 candidate matches',
    );
  });

  it('glosses the auto-apply distance as a whole percentage with the raw value in the disclosure', () => {
    const copy = entryCopy(
      im({
        kind: 'auto-apply-selected',
        candidate: { dataSource: 'MusicBrainz', albumId: 'a1' },
        distance: 0.1363750628456511,
      }),
    );
    expect(copy?.text).toBe('Confident match — importing automatically (86% match)');
    expect(copy?.detail).toEqual([{ label: 'Match distance', value: '0.1363750628456511' }]);
  });

  it('marks a required review as attention with a pathway to act', () => {
    const copy = entryCopy(im({ kind: 'review-required', reviewKind: 'match-review' }));
    expect(copy?.text).toBe('Needs your review');
    expect(copy?.state).toBe('attention');
    expect(copy?.link).toEqual({ href: '/reviews', label: 'Open the review' });
    expect(copy?.detail).toEqual([{ label: 'Review kind', value: 'match-review' }]);
  });

  it('glosses review resolutions in the user’s voice, echoing the action’s own verb', () => {
    expect(entryCopy(im({ kind: 'review-resolved', resolution: 'apply-candidate' }))?.text).toBe(
      'Review resolved — you approved a match',
    );
    expect(
      entryCopy(im({ kind: 'review-resolved', resolution: 'reject-unusable-delivery' }))?.text,
    ).toBe('Review resolved — you rejected the files — the search resumed');
    expect(entryCopy(im({ kind: 'review-resolved', resolution: 'reject' }))?.text).toBe(
      'Review resolved — you rejected the import',
    );
  });

  it('degrades an unknown resolution to the plain line with the verb in the disclosure', () => {
    const copy = entryCopy(im({ kind: 'review-resolved', resolution: 'new-verb' as never }));
    expect(copy?.text).toBe('Review resolved');
    expect(copy?.detail).toEqual([{ label: 'Resolution', value: 'new-verb' }]);
  });

  it('renders the library application as the happy ending', () => {
    const copy = entryCopy(im({ kind: 'applied', location: '/lib/final' }));
    expect(copy?.text).toBe('Added to the library');
    expect(copy?.state).toBe('success');
    expect(copy?.detail).toEqual([{ label: 'Library location', value: '/lib/final' }]);
  });

  it('marks remediation as attention with the failures in the disclosure', () => {
    const copy = entryCopy(
      im({
        kind: 'remediation-required',
        failures: [{ stage: 'artwork', message: 'no cover found' }],
      }),
    );
    expect(copy?.text).toBe('Added to the library, but needs attention');
    expect(copy?.state).toBe('attention');
    expect(copy?.detail).toEqual([{ label: 'artwork', value: 'no cover found' }]);
    expect(copy?.link).toEqual({ href: '/reviews', label: 'Open the review' });
  });

  it('renders an import rejection truthfully: nothing more will be tried', () => {
    const copy = entryCopy(
      im({ kind: 'rejected', reason: 'no readable audio files', filesDeleted: true }),
    );
    expect(copy?.text).toBe(
      'Import rejected — no readable audio files. Nothing more will be tried — request the release again for another attempt.',
    );
    expect(copy?.state).toBe('failure');
  });

  it('renders a recorded unusable-delivery verdict with its deterministic revival', () => {
    const copy = entryCopy(
      im({ kind: 'release-verdict-recorded', acquisitionId: 'acq-1', reasons: ['truncated'] }),
    );
    expect(copy?.text).toBe('Marked this delivery unusable — searching for a replacement');
    expect(copy?.detail).toEqual([{ label: 'Reasons', value: 'truncated' }]);
  });

  it('renders an unknown importer kind through the traced tolerant fallback', () => {
    const copy = entryCopy(im({ kind: 'brand-new-kind' } as never));
    expect(copy?.text).toBe('Something happened during import that this page can’t describe yet');
    expect(copy?.detail).toEqual([{ label: 'Event kind', value: 'brand-new-kind' }]);
  });
});

describe('entryCopy — register conformance', () => {
  // One representative entry per wire kind. The completeness test below derives the kind sets from
  // the facades' own runtime schemas, so a newly added kind fails here until it is sampled (and
  // given copy) — the sample list cannot silently rot.
  const downloaderSamples: readonly TimelineEntry[] = [
    dl({ kind: 'requested', request: { kind: 'musicbrainz', targetType: 'album', mbid: 'm-1' } }),
    dl({ kind: 'resolved', artist: 'A', title: 'T', year: 2000 }),
    dl({ kind: 'search-started', round: 1 }),
    dl({ kind: 'search-started', round: 2 }),
    dl({ kind: 'selected', candidate }),
    dl({ kind: 'download-started', candidate }),
    dl({ kind: 'download-failed', candidate, reason: 'Stalled' }),
    dl({ kind: 'validation-failed', candidate, reasons: ['Unplayable'] }),
    dl({ kind: 'imported', candidate, location: '/s' }),
    dl({ kind: 'fulfillment-rejected', candidate, reasons: ['bad'] }),
    dl({ kind: 'fulfilled', location: '/s' }),
    dl({ kind: 'exhausted' }),
    dl({ kind: 'conflicted', location: '/o' }),
    dl({ kind: 'metadata-failed' }),
    dl({ kind: 'cancelled' }),
  ];
  const importerSamples: readonly TimelineEntry[] = [
    im({ kind: 'requested' }),
    im({ kind: 'proposed', candidateCount: 2 }),
    im({
      kind: 'auto-apply-selected',
      candidate: { dataSource: 'MusicBrainz', albumId: 'c' },
      distance: 0.1,
    }),
    im({ kind: 'review-required', reviewKind: 'match-review' }),
    im({ kind: 'review-resolved', resolution: 'apply-candidate' }),
    im({ kind: 'applied', location: '/l' }),
    im({ kind: 'remediation-required', failures: [] }),
    im({ kind: 'rejected', reason: 'bad files', filesDeleted: false }),
    im({ kind: 'release-verdict-recorded', acquisitionId: 'a', reasons: [] }),
  ];
  const everyEntry = [...downloaderSamples, ...importerSamples];

  function kindsOf(schema: {
    options: readonly { shape: { kind: { value: string } } }[];
  }): Set<string> {
    return new Set(schema.options.map((option) => option.shape.kind.value));
  }

  it('samples every wire kind the facades publish (schema-derived completeness)', () => {
    expect(new Set(downloaderSamples.map((item) => item.entry.kind))).toEqual(
      kindsOf(historyEntrySchema),
    );
    expect(new Set(importerSamples.map((item) => item.entry.kind))).toEqual(
      kindsOf(importerHistoryEntrySchema),
    );
  });

  it.each(everyEntry.map((item) => [`${item.module}:${item.entry.kind}`, item] as const))(
    '%s keeps enum identifiers and architecture nouns out of the visible line',
    (_name, item) => {
      const copy = entryCopy(item);
      if (item.module === 'downloader' && item.entry.kind === 'fulfilled') {
        // The one curated-out kind — suppression is the specified rendering.
        expect(copy).toBeUndefined();
        return;
      }
      expect(copy).toBeDefined();
      for (const banned of [
        /importer/i,
        /staged/i,
        /\bTransferError\b/,
        /\bPeerUnavailable\b/,
        /\bQueueTimeout\b/,
        /\bFileUnavailable\b/,
        /\bStalled\b/,
        /\bUnplayable\b/,
        /\bDurationMismatch\b/,
        /apply-candidate/,
        /match-review/,
        /\bdistance\b/i,
      ]) {
        expect(copy?.text).not.toMatch(banned);
      }
    },
  );

  it('never ends a single-sentence line with a trailing period', () => {
    for (const item of everyEntry) {
      const copy = entryCopy(item);
      // Unconditional: only a single-sentence line ending in "." can match this pattern.
      expect(copy?.text ?? '').not.toMatch(/^[^.]*\.$/u);
    }
  });
});

describe('matchPercent', () => {
  it('rounds the inverted distance to a whole percentage', () => {
    expect(matchPercent(0.1363750628456511)).toBe(86);
    expect(matchPercent(0)).toBe(100);
    expect(matchPercent(1)).toBe(0);
  });
});

describe('metaSummary', () => {
  it('pluralizes and omits zero-count segments', () => {
    expect(metaSummary(1, 0)).toBe('1 attempt');
    expect(metaSummary(3, 2)).toBe('3 attempts · 2 sources rejected');
    expect(metaSummary(0, 1)).toBe('1 source rejected');
    expect(metaSummary(0, 0)).toBe('');
  });
});

describe('statusPhrase', () => {
  it('degrades an unknown future status to an honest cannot-describe phrase', () => {
    expect(statusPhrase('BrandNewStatus' as never)).toBe(
      'This page can\u{2019}t describe this step yet',
    );
  });

  it('degrades Object.prototype key names like any unknown status', () => {
    expect(statusPhrase('toString' as never)).toBe('This page can\u{2019}t describe this step yet');
  });

  it('phrases every status humanly, with terminal failures free of enum identifiers', () => {
    expect(statusPhrase('Validating')).toBe('Checking quality');
    expect(statusPhrase('MetadataFailed')).toBe('Couldn’t identify the release');
    expect(statusPhrase('Exhausted')).toBe('No usable download found');
  });
});

describe('isStorySettled', () => {
  it('an active acquisition is never settled', () => {
    expect(isStorySettled(acquisition({ status: 'Downloading' }), NO_IMPORT)).toBe(false);
  });

  it('a failed ending settles without any import', () => {
    expect(
      isStorySettled(acquisition({ status: 'Exhausted', cancellable: false }), NO_IMPORT),
    ).toBe(true);
    expect(
      isStorySettled(acquisition({ status: 'Cancelled', cancellable: false }), IMPORT_UNAVAILABLE),
    ).toBe(true);
  });

  it('a delivery is unsettled while its import does not exist yet or cannot be read', () => {
    const delivered = acquisition({ status: 'Fulfilled', cancellable: false });
    // The importer picks the delivery up asynchronously — 'none' here means "not yet", not "never".
    expect(isStorySettled(delivered, NO_IMPORT)).toBe(false);
    expect(isStorySettled(delivered, IMPORT_UNAVAILABLE)).toBe(false);
  });

  it('a delivery settles only on the import’s own decided settledness', () => {
    const delivered = acquisition({ status: 'Fulfilled', cancellable: false });
    expect(isStorySettled(delivered, importPresent({ status: 'applied', settled: true }))).toBe(
      true,
    );
    expect(isStorySettled(delivered, importPresent({ status: 'awaiting-review' }))).toBe(false);
    // An absent flag (older producer) reads conservatively as unsettled — keep watching.
    expect(
      isStorySettled(delivered, importPresent({ status: 'applied', settled: undefined })),
    ).toBe(false);
  });

  it('keeps watching a delivery whose import was rejected — the downloader may still revive it', () => {
    // The unusable-delivery verdict reaches the downloader asynchronously; resting on the
    // rejection would freeze the page right before the revival its own copy promises.
    const delivered = acquisition({ status: 'Fulfilled', cancellable: false });
    expect(isStorySettled(delivered, importPresent({ status: 'rejected', settled: true }))).toBe(
      false,
    );
  });
});

describe('overallStatus', () => {
  it('phrases active downloader statuses as human phrases', () => {
    expect(overallStatus(acquisition({ status: 'Pending' }), NO_IMPORT)).toEqual({
      tone: 'pending',
      phrase: 'Identifying the release',
    });
    expect(overallStatus(acquisition({ status: 'Downloading' }), NO_IMPORT)).toEqual({
      tone: 'pending',
      phrase: 'Downloading',
    });
  });

  it('phrases terminal failures without enum identifiers', () => {
    expect(
      overallStatus(acquisition({ status: 'MetadataFailed', cancellable: false }), NO_IMPORT),
    ).toEqual({ tone: 'failed', phrase: 'Couldn’t identify the release' });
    expect(
      overallStatus(acquisition({ status: 'Conflicted', cancellable: false }), NO_IMPORT),
    ).toEqual({ tone: 'failed', phrase: 'Stopped — destination occupied' });
  });

  it('never claims the library while the import side is absent or unreadable', () => {
    const delivered = acquisition({ status: 'Fulfilled', cancellable: false });
    expect(overallStatus(delivered, NO_IMPORT)).toEqual({
      tone: 'pending',
      phrase: 'Delivered — confirming the import',
    });
    expect(overallStatus(delivered, IMPORT_UNAVAILABLE)).toEqual({
      tone: 'pending',
      phrase: 'Delivered — import status unavailable',
    });
  });

  it('keeps a delivered acquisition honest while its import is still working', () => {
    const delivered = acquisition({ status: 'Fulfilled', cancellable: false });
    expect(overallStatus(delivered, importPresent({ status: 'proposing' }))).toEqual({
      tone: 'pending',
      phrase: 'Matching against the library',
    });
    expect(overallStatus(delivered, importPresent({ status: 'empty' }))).toEqual({
      tone: 'pending',
      phrase: 'Matching against the library',
    });
    expect(overallStatus(delivered, importPresent({ status: 'awaiting-review' }))).toEqual({
      tone: 'attention',
      phrase: 'Waiting for your review',
    });
    expect(overallStatus(delivered, importPresent({ status: 'applying' }))).toEqual({
      tone: 'pending',
      phrase: 'Adding to the library',
    });
  });

  it('reports the true endings once the import settles', () => {
    const delivered = acquisition({ status: 'Fulfilled', cancellable: false });
    expect(overallStatus(delivered, importPresent({ status: 'applied', settled: true }))).toEqual({
      tone: 'fulfilled',
      phrase: 'In your library',
    });
    expect(overallStatus(delivered, importPresent({ status: 'rejected', settled: true }))).toEqual({
      tone: 'failed',
      phrase: 'Import rejected',
    });
  });
});

describe('overallStatus — drifted import phase', () => {
  it('degrades a phase this page cannot know to the honest unconfirmed claim', () => {
    const delivered = acquisition({ status: 'Fulfilled', cancellable: false });
    expect(overallStatus(delivered, importPresent({ status: 'remediating' as never }))).toEqual({
      tone: 'pending',
      phrase: 'Delivered — confirming the import',
    });
  });
});

describe('pendingRowFor', () => {
  it('names the current downloader phase while active', () => {
    expect(pendingRowFor(acquisition({ status: 'Pending' }), NO_IMPORT)).toEqual({
      text: 'Identifying the release…',
      state: 'pending',
      showProgress: false,
    });
    expect(pendingRowFor(acquisition({ status: 'Empty' }), NO_IMPORT)).toEqual({
      text: 'Identifying the release…',
      state: 'pending',
      showProgress: false,
    });
    expect(pendingRowFor(acquisition({ status: 'Searching' }), NO_IMPORT)).toEqual({
      text: 'Searching for a download…',
      state: 'pending',
      showProgress: false,
    });
    expect(pendingRowFor(acquisition({ status: 'Validating' }), NO_IMPORT)).toEqual({
      text: 'Checking audio quality…',
      state: 'pending',
      showProgress: false,
    });
  });

  it('names the hand-off and selection phases while active', () => {
    expect(pendingRowFor(acquisition({ status: 'Importing' }), NO_IMPORT)).toEqual({
      text: 'Adding to the library…',
      state: 'pending',
      showProgress: false,
    });
    expect(pendingRowFor(acquisition({ status: 'Selecting' }), NO_IMPORT)).toEqual({
      text: 'Searching for a download…',
      state: 'pending',
      showProgress: false,
    });
  });

  it('marks a wait on the user as attention, not a spinner', () => {
    expect(pendingRowFor(acquisition({ status: 'AwaitingManualSelection' }), NO_IMPORT)).toEqual({
      text: 'Waiting for you to choose an edition',
      state: 'attention',
      showProgress: false,
    });
  });

  it('names the source and carries progress while the transfer is live', () => {
    expect(
      pendingRowFor(
        acquisition({ status: 'Downloading', currentCandidate: candidate, transferStarted: true }),
        NO_IMPORT,
      ),
    ).toEqual({ text: 'Downloading from xronin…', state: 'pending', showProgress: true });
  });

  it('live transfers without a known source still read as downloading', () => {
    expect(
      pendingRowFor(acquisition({ status: 'Downloading', transferStarted: true }), NO_IMPORT),
    ).toEqual({
      text: 'Downloading…',
      state: 'pending',
      showProgress: true,
    });
  });

  it('a selected candidate whose transfer has not started reads as preparing, without a bar', () => {
    // Between the selection and the source accepting the enqueue there is nothing to measure:
    // an honest "preparing" instead of a downloading claim with a blank progress bar.
    expect(
      pendingRowFor(
        acquisition({
          status: 'Downloading',
          currentCandidate: candidate,
          transferStarted: false,
        }),
        NO_IMPORT,
      ),
    ).toEqual({
      text: 'Preparing the transfer from xronin…',
      state: 'pending',
      showProgress: false,
    });
    expect(pendingRowFor(acquisition({ status: 'Downloading' }), NO_IMPORT)).toEqual({
      text: 'Preparing the transfer…',
      state: 'pending',
      showProgress: false,
    });
  });

  it('an absent decided flag (older producer) degrades to the preparing row', () => {
    expect(
      pendingRowFor(acquisition({ status: 'Downloading', currentCandidate: candidate }), NO_IMPORT),
    ).toEqual({
      text: 'Preparing the transfer from xronin…',
      state: 'pending',
      showProgress: false,
    });
  });

  it('still narrates when the decided flag is absent (older producer)', () => {
    // Liveness gates on decided terminality, not the cancel affordance: an absent flag must not
    // silently end the narration mid-story.
    expect(
      pendingRowFor(acquisition({ status: 'Downloading', cancellable: undefined }), NO_IMPORT),
    ).toEqual({ text: 'Preparing the transfer…', state: 'pending', showProgress: false });
  });

  it('claims nothing when the enum and the decided flag contradict', () => {
    expect(
      pendingRowFor(acquisition({ status: 'Exhausted', cancellable: undefined }), NO_IMPORT),
    ).toBeUndefined();
    expect(
      pendingRowFor(acquisition({ status: 'Fulfilled', cancellable: true }), NO_IMPORT),
    ).toBeUndefined();
  });

  it('keeps narrating the async gap after delivery until the import appears', () => {
    const delivered = acquisition({ status: 'Fulfilled', cancellable: false });
    expect(pendingRowFor(delivered, NO_IMPORT)).toEqual({
      text: 'Adding to the library…',
      state: 'pending',
      showProgress: false,
    });
    expect(pendingRowFor(delivered, IMPORT_UNAVAILABLE)).toEqual({
      text: 'Adding to the library…',
      state: 'pending',
      showProgress: false,
    });
  });

  it('follows the import phase after delivery', () => {
    const delivered = acquisition({ status: 'Fulfilled', cancellable: false });
    for (const status of ['empty', 'requested', 'proposing'] as const) {
      expect(pendingRowFor(delivered, importPresent({ status }))).toEqual({
        text: 'Matching against the library…',
        state: 'pending',
        showProgress: false,
      });
    }
    expect(pendingRowFor(delivered, importPresent({ status: 'awaiting-review' }))).toEqual({
      text: 'Waiting for your review',
      state: 'attention',
      link: { href: '/reviews', label: 'Open the review' },
      showProgress: false,
    });
    expect(pendingRowFor(delivered, importPresent({ status: 'applying' }))).toEqual({
      text: 'Adding to the library…',
      state: 'pending',
      showProgress: false,
    });
  });

  it('keeps honest narration for a drifted import phase', () => {
    const delivered = acquisition({ status: 'Fulfilled', cancellable: false });
    expect(pendingRowFor(delivered, importPresent({ status: 'remediating' as never }))).toEqual({
      text: 'Adding to the library…',
      state: 'pending',
      showProgress: false,
    });
  });

  it('renders no pending row once the story is settled', () => {
    expect(
      pendingRowFor(acquisition({ status: 'Exhausted', cancellable: false }), NO_IMPORT),
    ).toBeUndefined();
    expect(
      pendingRowFor(
        acquisition({ status: 'Fulfilled', cancellable: false }),
        importPresent({ status: 'applied', settled: true }),
      ),
    ).toBeUndefined();
    expect(
      pendingRowFor(
        acquisition({ status: 'Fulfilled', cancellable: false }),
        importPresent({ status: 'rejected', settled: true }),
      ),
    ).toBeUndefined();
  });
});

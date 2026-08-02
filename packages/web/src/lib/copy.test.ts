import { describe, expect, it } from 'vitest';
import type { AcquisitionStatusResponseDto } from '@music/downloader';
import type { ImportStatusResponseDto } from '@music/importer';
import { entryCopy, matchPercent, metaSummary, overallStatus, pendingRowFor } from './copy.js';
import type { TimelineEntry } from './timeline.js';

const candidate = {
  username: 'xronin',
  path: String.raw`@@ygcrs\MUSIC\RAM (2013)`,
  sizeBytes: 900_000_000,
};

function downloaderEntry(entry: unknown): TimelineEntry {
  const typed = entry as { at?: string };
  return {
    module: 'downloader',
    at: typed.at ?? '2026-08-01T10:00:00Z',
    entry,
  } as TimelineEntry;
}

function importerEntry(entry: unknown): TimelineEntry {
  const typed = entry as { at?: string };
  return {
    module: 'importer',
    at: typed.at ?? '2026-08-01T10:00:00Z',
    entry,
  } as TimelineEntry;
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

function importStatus(overrides: Partial<ImportStatusResponseDto>): ImportStatusResponseDto {
  return {
    importId: 'imp-1',
    status: 'requested',
    history: [],
    ...overrides,
  };
}

describe('entryCopy — downloader entries', () => {
  it('renders the request as a plain requested line with the request in the disclosure', () => {
    const copy = entryCopy(
      downloaderEntry({
        kind: 'requested',
        at: '2026-08-01T10:00:00Z',
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

  it('describes an id request in the disclosure by its id', () => {
    const copy = entryCopy(
      downloaderEntry({
        kind: 'requested',
        at: '2026-08-01T10:00:00Z',
        request: { kind: 'release-group', targetType: 'album', mbid: 'rg-123' },
      }),
    );
    expect(copy?.detail).toEqual([{ label: 'Request', value: 'MusicBrainz release group rg-123' }]);
  });

  it('renders resolution with the release identity and year', () => {
    const copy = entryCopy(
      downloaderEntry({
        kind: 'resolved',
        at: 't',
        artist: 'Willie Nelson',
        title: 'Red Headed Stranger',
        year: 1975,
      }),
    );
    expect(copy?.text).toBe('Matched to MusicBrainz — Willie Nelson, Red Headed Stranger (1975)');
    expect(copy?.detail).toEqual([]);
  });

  it('renders resolution without a year when none is known', () => {
    const copy = entryCopy(downloaderEntry({ kind: 'resolved', at: 't', artist: 'A', title: 'T' }));
    expect(copy?.text).toBe('Matched to MusicBrainz — A, T');
  });

  it('renders the first search round as the search starting', () => {
    const copy = entryCopy(downloaderEntry({ kind: 'search-started', at: 't', round: 1 }));
    expect(copy?.text).toBe('Started searching for a download');
    expect(copy?.detail).toEqual([]);
  });

  it('renders a later search round as searching again, with the round in the disclosure', () => {
    const copy = entryCopy(downloaderEntry({ kind: 'search-started', at: 't', round: 3 }));
    expect(copy?.text).toBe('Searched again for another source');
    expect(copy?.detail).toEqual([{ label: 'Search round', value: '3' }]);
  });

  it('renders a selection with the source inline and the path in the disclosure', () => {
    const copy = entryCopy(downloaderEntry({ kind: 'selected', at: 't', candidate }));
    expect(copy?.text).toBe('Chose a download from xronin');
    expect(copy?.detail).toEqual([
      { label: 'Source path', value: String.raw`@@ygcrs\MUSIC\RAM (2013)` },
      { label: 'Size', value: '858.3 MiB' },
    ]);
  });

  it('glosses a known download-failure reason and keeps the code in the disclosure', () => {
    const copy = entryCopy(
      downloaderEntry({ kind: 'download-failed', at: 't', candidate, reason: 'TransferError' }),
    );
    expect(copy?.text).toBe('Download failed — the transfer was cut off. Trying the next source.');
    expect(copy?.state).toBe('failure');
    expect(copy?.detail).toEqual([
      { label: 'Reason code', value: 'TransferError' },
      { label: 'Source path', value: String.raw`@@ygcrs\MUSIC\RAM (2013)` },
    ]);
  });

  it('degrades an unmapped download-failure reason to the generic line with the code in the disclosure', () => {
    const copy = entryCopy(
      downloaderEntry({ kind: 'download-failed', at: 't', candidate, reason: 'SomethingNew' }),
    );
    expect(copy?.text).toBe('Download failed — trying the next source.');
    expect(copy?.detail?.[0]).toEqual({ label: 'Reason code', value: 'SomethingNew' });
  });

  it('glosses validation failures and keeps the raw reasons in the disclosure', () => {
    const copy = entryCopy(
      downloaderEntry({
        kind: 'validation-failed',
        at: 't',
        candidate,
        reasons: ['Unplayable', 'DurationMismatch'],
      }),
    );
    expect(copy?.text).toBe(
      'The files failed quality checks — some files were unplayable; track lengths didn’t match the release. Trying the next source.',
    );
    expect(copy?.state).toBe('failure');
    expect(copy?.detail?.[0]).toEqual({
      label: 'Reason codes',
      value: 'Unplayable, DurationMismatch',
    });
  });

  it('carries an unmapped validation reason verbatim in the gloss slot (tolerant reader)', () => {
    const copy = entryCopy(
      downloaderEntry({
        kind: 'validation-failed',
        at: 't',
        candidate,
        reasons: ['SomethingNew'],
      }),
    );
    expect(copy?.text).toBe(
      'The files failed quality checks — SomethingNew. Trying the next source.',
    );
  });

  it('renders the hand-off without naming the importer', () => {
    const copy = entryCopy(
      downloaderEntry({ kind: 'imported', at: 't', candidate, location: '/staging/a' }),
    );
    expect(copy?.text).toBe('Download complete — preparing to add to the library');
    expect(copy?.detail).toEqual([{ label: 'Delivered to', value: '/staging/a' }]);
  });

  it('renders a delivery rejection with its reasons and the next step', () => {
    const copy = entryCopy(
      downloaderEntry({
        kind: 'fulfillment-rejected',
        at: 't',
        candidate,
        reasons: ['corrupt stub'],
      }),
    );
    expect(copy?.text).toBe('Delivery rejected — corrupt stub. Searching for a replacement.');
    expect(copy?.state).toBe('failure');
  });

  it('suppresses the downloader fulfilled entry (the hand-off already covers that moment)', () => {
    expect(
      entryCopy(downloaderEntry({ kind: 'fulfilled', at: 't', location: '/staging/a' })),
    ).toBeUndefined();
  });

  it('ends an exhausted story with the reason and a remediation hint', () => {
    const copy = entryCopy(downloaderEntry({ kind: 'exhausted', at: 't' }));
    expect(copy?.text).toBe(
      'Gave up — every source failed or came up empty. Request it again to search anew.',
    );
    expect(copy?.state).toBe('failure');
  });

  it('describes a conflict as an occupied destination, nothing overwritten', () => {
    const copy = entryCopy(
      downloaderEntry({ kind: 'conflicted', at: 't', location: '/lib/occupied' }),
    );
    expect(copy?.text).toBe(
      'Stopped — the destination already had files for this release. Nothing was overwritten.',
    );
    expect(copy?.detail).toEqual([{ label: 'Occupied location', value: '/lib/occupied' }]);
  });

  it('ends a failed resolution with a check-and-retry hint', () => {
    const copy = entryCopy(downloaderEntry({ kind: 'metadata-failed', at: 't' }));
    expect(copy?.text).toBe(
      'Couldn’t identify this release. Check the artist and title, then request it again.',
    );
    expect(copy?.state).toBe('failure');
  });

  it('renders a cancellation plainly', () => {
    const copy = entryCopy(downloaderEntry({ kind: 'cancelled', at: 't' }));
    expect(copy?.text).toBe('Cancelled');
    expect(copy?.state).toBe('routine');
  });

  it('renders an unknown downloader kind through the tolerant fallback', () => {
    const copy = entryCopy(downloaderEntry({ kind: 'brand-new-kind', at: 't' }));
    expect(copy?.text).toBe('Something happened that this page can’t describe yet');
    expect(copy?.state).toBe('routine');
  });
});

describe('entryCopy — importer entries (no module prefix, unified voice)', () => {
  it('renders the import start without stuttering', () => {
    const copy = entryCopy(importerEntry({ kind: 'requested', at: 't' }));
    expect(copy?.text).toBe('Import started');
  });

  it('pluralizes the candidate comparison', () => {
    expect(entryCopy(importerEntry({ kind: 'proposed', at: 't', candidateCount: 1 }))?.text).toBe(
      'Compared against the library — 1 candidate match',
    );
    expect(entryCopy(importerEntry({ kind: 'proposed', at: 't', candidateCount: 3 }))?.text).toBe(
      'Compared against the library — 3 candidate matches',
    );
  });

  it('glosses the auto-apply distance as a whole percentage with the raw value in the disclosure', () => {
    const copy = entryCopy(
      importerEntry({
        kind: 'auto-apply-selected',
        at: 't',
        candidate: { id: 'c1' },
        distance: 0.1363750628456511,
      }),
    );
    expect(copy?.text).toBe('Confident match — importing automatically (86% match)');
    expect(copy?.detail).toEqual([{ label: 'Match distance', value: '0.1363750628456511' }]);
  });

  it('marks a required review as attention with a pathway to act', () => {
    const copy = entryCopy(
      importerEntry({ kind: 'review-required', at: 't', reviewKind: 'match-review' }),
    );
    expect(copy?.text).toBe('Needs your review');
    expect(copy?.state).toBe('attention');
    expect(copy?.link).toEqual({ href: '/reviews', label: 'Open the review' });
    expect(copy?.detail).toEqual([{ label: 'Review kind', value: 'match-review' }]);
  });

  it('glosses review resolutions in the user’s voice', () => {
    expect(
      entryCopy(importerEntry({ kind: 'review-resolved', at: 't', resolution: 'apply-candidate' }))
        ?.text,
    ).toBe('Review resolved — you approved the match');
    expect(
      entryCopy(
        importerEntry({ kind: 'review-resolved', at: 't', resolution: 'reject-unusable-delivery' }),
      )?.text,
    ).toBe('Review resolved — you rejected the files. A new download will be tried.');
  });

  it('degrades an unknown resolution to the plain line with the verb in the disclosure', () => {
    const copy = entryCopy(
      importerEntry({ kind: 'review-resolved', at: 't', resolution: 'new-verb' }),
    );
    expect(copy?.text).toBe('Review resolved');
    expect(copy?.detail).toEqual([{ label: 'Resolution', value: 'new-verb' }]);
  });

  it('renders the library application as the happy ending', () => {
    const copy = entryCopy(importerEntry({ kind: 'applied', at: 't', location: '/lib/final' }));
    expect(copy?.text).toBe('Added to the library');
    expect(copy?.state).toBe('success');
    expect(copy?.detail).toEqual([{ label: 'Library location', value: '/lib/final' }]);
  });

  it('marks remediation as attention with the failures in the disclosure', () => {
    const copy = entryCopy(
      importerEntry({
        kind: 'remediation-required',
        at: 't',
        failures: [{ stage: 'artwork', message: 'no cover found' }],
      }),
    );
    expect(copy?.text).toBe('Added to the library, but needs attention');
    expect(copy?.state).toBe('attention');
    expect(copy?.detail).toEqual([{ label: 'artwork', value: 'no cover found' }]);
  });

  it('renders an import rejection with its reason and the next step', () => {
    const copy = entryCopy(
      importerEntry({
        kind: 'rejected',
        at: 't',
        reason: 'no readable audio files',
        filesDeleted: true,
      }),
    );
    expect(copy?.text).toBe(
      'Import rejected — no readable audio files. A new download will be tried.',
    );
    expect(copy?.state).toBe('failure');
  });

  it('renders a recorded unusable-delivery verdict as the user’s act', () => {
    const copy = entryCopy(
      importerEntry({
        kind: 'release-verdict-recorded',
        at: 't',
        acquisitionId: 'acq-1',
        reasons: ['truncated tracks'],
      }),
    );
    expect(copy?.text).toBe('Marked this delivery unusable — retrying the download');
    expect(copy?.detail).toEqual([{ label: 'Reasons', value: 'truncated tracks' }]);
  });

  it('renders an unknown importer kind through the tolerant fallback', () => {
    const copy = entryCopy(importerEntry({ kind: 'brand-new-kind', at: 't' }));
    expect(copy?.text).toBe('Something happened during import that this page can’t describe yet');
  });
});

describe('entryCopy — register conformance', () => {
  const everyEntry: TimelineEntry[] = [
    downloaderEntry({
      kind: 'requested',
      at: 't',
      request: { kind: 'musicbrainz', targetType: 'album', mbid: 'm-1' },
    }),
    downloaderEntry({ kind: 'resolved', at: 't', artist: 'A', title: 'T', year: 2000 }),
    downloaderEntry({ kind: 'search-started', at: 't', round: 1 }),
    downloaderEntry({ kind: 'search-started', at: 't', round: 2 }),
    downloaderEntry({ kind: 'selected', at: 't', candidate }),
    downloaderEntry({ kind: 'download-failed', at: 't', candidate, reason: 'Stalled' }),
    downloaderEntry({ kind: 'validation-failed', at: 't', candidate, reasons: ['Unplayable'] }),
    downloaderEntry({ kind: 'imported', at: 't', candidate, location: '/s' }),
    downloaderEntry({ kind: 'fulfillment-rejected', at: 't', candidate, reasons: ['bad'] }),
    downloaderEntry({ kind: 'exhausted', at: 't' }),
    downloaderEntry({ kind: 'conflicted', at: 't', location: '/o' }),
    downloaderEntry({ kind: 'metadata-failed', at: 't' }),
    downloaderEntry({ kind: 'cancelled', at: 't' }),
    importerEntry({ kind: 'requested', at: 't' }),
    importerEntry({ kind: 'proposed', at: 't', candidateCount: 2 }),
    importerEntry({ kind: 'auto-apply-selected', at: 't', candidate: { id: 'c' }, distance: 0.1 }),
    importerEntry({ kind: 'review-required', at: 't', reviewKind: 'match-review' }),
    importerEntry({ kind: 'review-resolved', at: 't', resolution: 'apply-candidate' }),
    importerEntry({ kind: 'applied', at: 't', location: '/l' }),
    importerEntry({ kind: 'remediation-required', at: 't', failures: [] }),
    importerEntry({ kind: 'rejected', at: 't', reason: 'bad files', filesDeleted: false }),
    importerEntry({ kind: 'release-verdict-recorded', at: 't', acquisitionId: 'a', reasons: [] }),
  ];

  it('keeps enum identifiers and architecture nouns out of every visible line', () => {
    for (const item of everyEntry) {
      const copy = entryCopy(item);
      if (copy === undefined) continue;
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
        expect(copy.text).not.toMatch(banned);
      }
    }
  });

  it('never ends a single-sentence line with a trailing period', () => {
    for (const item of everyEntry) {
      const copy = entryCopy(item);
      if (copy === undefined) continue;
      const sentences = copy.text.split('. ');
      if (sentences.length === 1) expect(copy.text.endsWith('.')).toBe(false);
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

describe('overallStatus', () => {
  it('phrases active downloader statuses as human phrases', () => {
    expect(overallStatus(acquisition({ status: 'Pending' }), 'none')).toEqual({
      tone: 'pending',
      phrase: 'Identifying the release',
    });
    expect(overallStatus(acquisition({ status: 'Downloading' }), 'none')).toEqual({
      tone: 'pending',
      phrase: 'Downloading',
    });
  });

  it('phrases terminal failures without enum identifiers', () => {
    expect(
      overallStatus(acquisition({ status: 'MetadataFailed', cancellable: false }), 'none'),
    ).toEqual({
      tone: 'failed',
      phrase: 'Couldn’t identify the release',
    });
    expect(overallStatus(acquisition({ status: 'Exhausted', cancellable: false }), 'none')).toEqual(
      {
        tone: 'failed',
        phrase: 'No usable download found',
      },
    );
    expect(
      overallStatus(acquisition({ status: 'Conflicted', cancellable: false }), 'none'),
    ).toEqual({
      tone: 'failed',
      phrase: 'Stopped — destination occupied',
    });
  });

  it('keeps a delivered acquisition honest while its import is still working', () => {
    const delivered = acquisition({ status: 'Fulfilled', cancellable: false });
    expect(overallStatus(delivered, 'present', importStatus({ status: 'proposing' }))).toEqual({
      tone: 'pending',
      phrase: 'Matching against the library',
    });
    expect(
      overallStatus(delivered, 'present', importStatus({ status: 'awaiting-review' })),
    ).toEqual({
      tone: 'attention',
      phrase: 'Waiting for your review',
    });
    expect(overallStatus(delivered, 'present', importStatus({ status: 'applying' }))).toEqual({
      tone: 'pending',
      phrase: 'Adding to the library',
    });
  });

  it('reports the true endings once the import settles', () => {
    const delivered = acquisition({ status: 'Fulfilled', cancellable: false });
    expect(overallStatus(delivered, 'present', importStatus({ status: 'applied' }))).toEqual({
      tone: 'fulfilled',
      phrase: 'In your library',
    });
    expect(overallStatus(delivered, 'present', importStatus({ status: 'rejected' }))).toEqual({
      tone: 'failed',
      phrase: 'Import rejected',
    });
    expect(overallStatus(delivered, 'none')).toEqual({
      tone: 'fulfilled',
      phrase: 'In your library',
    });
  });
});

describe('pendingRowFor', () => {
  it('names the current downloader phase while active', () => {
    expect(pendingRowFor(acquisition({ status: 'Pending' }), 'none')).toEqual({
      text: 'Identifying the release…',
      state: 'pending',
      showProgress: false,
    });
    expect(pendingRowFor(acquisition({ status: 'Searching' }), 'none')).toEqual({
      text: 'Searching for a download…',
      state: 'pending',
      showProgress: false,
    });
    expect(pendingRowFor(acquisition({ status: 'Validating' }), 'none')).toEqual({
      text: 'Checking audio quality…',
      state: 'pending',
      showProgress: false,
    });
  });

  it('names the hand-off and selection phases while active', () => {
    expect(pendingRowFor(acquisition({ status: 'Importing' }), 'none')).toEqual({
      text: 'Adding to the library…',
      state: 'pending',
      showProgress: false,
    });
    expect(pendingRowFor(acquisition({ status: 'Selecting' }), 'none')).toEqual({
      text: 'Searching for a download…',
      state: 'pending',
      showProgress: false,
    });
  });

  it('marks a wait on the user as attention, not a spinner', () => {
    expect(pendingRowFor(acquisition({ status: 'AwaitingManualSelection' }), 'none')).toEqual({
      text: 'Waiting for you to choose an edition',
      state: 'attention',
      showProgress: false,
    });
  });

  it('names the source and carries progress while downloading', () => {
    const downloading = acquisition({
      status: 'Downloading',
      currentCandidate: candidate,
    });
    expect(pendingRowFor(downloading, 'none')).toEqual({
      text: 'Downloading from xronin…',
      state: 'pending',
      showProgress: true,
    });
  });

  it('downloads without a known source still read as downloading', () => {
    expect(pendingRowFor(acquisition({ status: 'Downloading' }), 'none')).toEqual({
      text: 'Downloading…',
      state: 'pending',
      showProgress: true,
    });
  });

  it('follows the import phase after delivery', () => {
    const delivered = acquisition({ status: 'Fulfilled', cancellable: false });
    expect(pendingRowFor(delivered, 'present', importStatus({ status: 'requested' }))).toEqual({
      text: 'Matching against the library…',
      state: 'pending',
      showProgress: false,
    });
    expect(
      pendingRowFor(delivered, 'present', importStatus({ status: 'awaiting-review' })),
    ).toEqual({
      text: 'Waiting for your review',
      state: 'attention',
      link: { href: '/reviews', label: 'Open the review' },
      showProgress: false,
    });
    expect(pendingRowFor(delivered, 'present', importStatus({ status: 'applying' }))).toEqual({
      text: 'Adding to the library…',
      state: 'pending',
      showProgress: false,
    });
  });

  it('renders no pending row once the story is settled', () => {
    expect(
      pendingRowFor(acquisition({ status: 'Exhausted', cancellable: false }), 'none'),
    ).toBeUndefined();
    expect(
      pendingRowFor(
        acquisition({ status: 'Fulfilled', cancellable: false }),
        'present',
        importStatus({ status: 'applied' }),
      ),
    ).toBeUndefined();
    expect(
      pendingRowFor(acquisition({ status: 'Fulfilled', cancellable: false }), 'none'),
    ).toBeUndefined();
  });
});

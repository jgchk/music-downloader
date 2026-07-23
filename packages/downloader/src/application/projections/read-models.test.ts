import { describe, expect, it } from 'vitest';
import {
  AcquisitionStatusProjection,
  LibraryViewProjection,
  ProgressReadModel,
  StalledReadModel,
  projectStatus,
} from './read-models.js';
import { FakeEventStore } from '../__fixtures__/fakes.js';
import { asMbid } from '../../domain/shared/__fixtures__/mbid.js';
import { asUnit } from '../../domain/shared/__fixtures__/unit.js';
import type { AcquisitionEvent } from '../../domain/acquisition/events.js';
import type { StoredEvent } from '../ports/event-store-port.js';
import {
  awaitingSelectionHistory,
  defaultPolicies,
  importingHistory,
  matchingCandidate,
  rankedOf,
  requestedHistory,
  resolvedHistory,
  sampleEditionCandidates,
  sampleRequest,
  sampleTarget,
  selectedHistory,
  validatingHistory,
} from '../../domain/acquisition/__fixtures__/acquisition-fixtures.js';

const a = matchingCandidate('a');
const b = matchingCandidate('b');
const c = matchingCandidate('c');

const history: AcquisitionEvent[] = [
  { type: 'AcquisitionRequested', request: sampleRequest, policies: defaultPolicies() },
  { type: 'TargetResolved', target: sampleTarget },
  { type: 'SearchCompleted', round: 1, candidates: [a, b, c] },
  { type: 'CandidatesRanked', ranked: rankedOf([a, b, c]) },
  { type: 'CandidateSelected', candidate: a },
  { type: 'DownloadFailed', candidate: a.identity, reason: 'Stalled' },
  { type: 'CandidateRejected', candidate: a.identity },
  { type: 'CandidateSelected', candidate: b },
  { type: 'DownloadCompleted', candidate: b.identity, files: [] },
  {
    type: 'ValidationFailed',
    candidate: b.identity,
    verdict: { confidence: asUnit(0), reasons: ['DurationMismatch'] },
  },
  { type: 'CandidateRejected', candidate: b.identity },
  { type: 'CandidateSelected', candidate: c },
  { type: 'DownloadCompleted', candidate: c.identity, files: [] },
  {
    type: 'ValidationPassed',
    candidate: c.identity,
    verdict: { confidence: asUnit(1), reasons: [] },
  },
  { type: 'Imported', candidate: c.identity, location: '/lib/c' },
  { type: 'AcquisitionFulfilled', location: '/lib/c' },
];

function stored(events: readonly AcquisitionEvent[]): readonly StoredEvent[] {
  const store = new FakeEventStore();
  store.append('acq-1', 0, events, { acquisitionId: 'acq-1', occurredAt: 't' });
  return store.all();
}

describe('projectStatus', () => {
  it('summarizes state and attempt history from the log', () => {
    const view = projectStatus('acq-1', stored(history));
    expect(view.status).toBe('Fulfilled');
    expect(view.target).toEqual({ artist: sampleTarget.artist, title: sampleTarget.title });
    expect(view.location).toBe('/lib/c');
    expect(view.attempts).toBe(3);
    expect(view.rejectedCount).toBe(2);
    // A fulfilled acquisition has nothing in flight, so it reports no current candidate; the
    // candidate that succeeded is recorded in the history's 'imported' entry below.
    expect(view.currentCandidate).toBeUndefined();
    expect(view.history.map((entry) => entry.kind)).toEqual([
      'selected',
      'download-failed',
      'selected',
      'validation-failed',
      'selected',
      'imported',
    ]);
  });

  it('stamps each history entry with its event occurrence time', () => {
    const events: AcquisitionEvent[] = [
      { type: 'CandidateSelected', candidate: a },
      { type: 'DownloadFailed', candidate: a.identity, reason: 'Stalled' },
    ];
    const storedEvents: StoredEvent[] = events.map((event, index) => ({
      globalSeq: index + 1,
      streamId: 'acq-1',
      version: index,
      type: event.type,
      event,
      metadata: { acquisitionId: 'acq-1', occurredAt: `2026-01-01T00:00:0${index}Z` },
    }));
    const view = projectStatus('acq-1', storedEvents);
    expect(view.history.map((entry) => entry.at)).toEqual([
      '2026-01-01T00:00:00Z',
      '2026-01-01T00:00:01Z',
    ]);
  });
});

describe('projectStatus — target description', () => {
  it('is absent before any target is known for a musicbrainz request', () => {
    const view = projectStatus(
      'acq-1',
      stored([
        { type: 'AcquisitionRequested', request: sampleRequest, policies: defaultPolicies() },
      ]),
    );
    expect(view.target).toBeUndefined();
  });

  it('falls back to the descriptor request before resolution', () => {
    const view = projectStatus(
      'acq-1',
      stored([
        {
          type: 'AcquisitionRequested',
          request: { kind: 'descriptor', targetType: 'album', artist: 'Artist', title: 'Album' },
          policies: defaultPolicies(),
        },
      ]),
    );
    expect(view.target).toEqual({ artist: 'Artist', title: 'Album' });
  });
});

describe('projectStatus — awaiting manual edition selection', () => {
  it('exposes the retained candidate editions while awaiting a choice', () => {
    const view = projectStatus('acq-1', stored(awaitingSelectionHistory()));
    expect(view.status).toBe('AwaitingManualSelection');
    expect(view.candidates).toEqual(sampleEditionCandidates);
  });

  it('drops the candidates once an edition is selected and the flow resumes', () => {
    const view = projectStatus(
      'acq-1',
      stored([
        ...awaitingSelectionHistory(),
        { type: 'EditionSelected', releaseMbid: asMbid('boot-1') },
      ]),
    );
    expect(view.status).toBe('Pending');
    expect(view.candidates).toBeUndefined();
  });
});

describe('projectStatus — decided lifecycle flags', () => {
  // A Selecting state: a candidate ranked, none yet in flight (non-terminal, not awaiting).
  const selectingHistory: AcquisitionEvent[] = [
    ...selectedHistory([a, b]),
    { type: 'DownloadFailed', candidate: a.identity, reason: 'Stalled' },
    { type: 'CandidateRejected', candidate: a.identity },
  ];

  // One reachable history per terminal phase — the domain's own terminal set (state.ts TERMINAL_PHASES).
  const terminalHistories: Record<
    'Fulfilled' | 'Exhausted' | 'Cancelled' | 'MetadataFailed' | 'Conflicted',
    AcquisitionEvent[]
  > = {
    Fulfilled: history,
    Exhausted: [...selectingHistory, { type: 'AcquisitionExhausted' }],
    Cancelled: [...selectedHistory([a]), { type: 'AcquisitionCancelled' }],
    MetadataFailed: [...requestedHistory(), { type: 'MetadataResolutionFailed' }],
    Conflicted: [...importingHistory([a]), { type: 'ImportConflicted', location: '/x' }],
  };

  // One reachable history per non-terminal, non-awaiting phase — the whole non-terminal set save
  // AwaitingManualSelection, which the awaiting-selection test below covers on its own.
  const nonTerminalHistories: Record<
    'Empty' | 'Pending' | 'Searching' | 'Selecting' | 'Downloading' | 'Validating' | 'Importing',
    AcquisitionEvent[]
  > = {
    Empty: [],
    Pending: requestedHistory(),
    Searching: resolvedHistory(),
    Selecting: selectingHistory,
    Downloading: selectedHistory([a]),
    Validating: validatingHistory([a]),
    Importing: importingHistory([a]),
  };

  it.each(Object.entries(terminalHistories))(
    'reports terminal %s as not cancellable and not awaiting',
    (phase, events) => {
      const view = projectStatus('acq-1', stored(events));
      expect(view.status).toBe(phase);
      expect(view.cancellable).toBe(false);
      expect(view.awaitingSelection).toBe(false);
    },
  );

  it.each(Object.entries(nonTerminalHistories))(
    'reports non-terminal %s as cancellable and not awaiting',
    (phase, events) => {
      const view = projectStatus('acq-1', stored(events));
      expect(view.status).toBe(phase);
      expect(view.cancellable).toBe(true);
      expect(view.awaitingSelection).toBe(false);
    },
  );

  it('reports an awaiting-selection acquisition as awaiting selection and still cancellable', () => {
    const awaiting = projectStatus('acq-1', stored(awaitingSelectionHistory()));
    expect(awaiting.status).toBe('AwaitingManualSelection');
    expect(awaiting.awaitingSelection).toBe(true);
    expect(awaiting.cancellable).toBe(true);
  });
});

describe('projectStatus — an external fulfilment rejection', () => {
  it('is recorded in the history with its reasons', () => {
    const view = projectStatus(
      'acq-1',
      stored([
        ...history,
        { type: 'FulfillmentRejected', candidate: c.identity, reasons: ['corrupt stub'] },
      ]),
    );
    expect(view.history.at(-1)).toEqual({
      kind: 'fulfillment-rejected',
      at: 't',
      candidate: c.identity,
      reasons: ['corrupt stub'],
    });
  });
});

describe('AcquisitionStatusProjection', () => {
  function applied(): AcquisitionStatusProjection {
    const projection = new AcquisitionStatusProjection();
    for (const entry of stored(history)) projection.apply(entry);
    return projection;
  }

  it('reads back the view for an acquisition it has applied', () => {
    expect(applied().get('acq-1')?.status).toBe('Fulfilled');
  });

  it('reports nothing for an unknown acquisition id', () => {
    expect(applied().get('missing')).toBeUndefined();
  });

  it('lists one entry per applied acquisition', () => {
    expect(applied().list()).toHaveLength(1);
  });

  it('rebuilds its view from the log', () => {
    const projection = new AcquisitionStatusProjection();
    projection.rebuild(stored(history));
    expect(projection.get('acq-1')?.attempts).toBe(3);
  });
});

describe('ProgressReadModel', () => {
  it('stores and reads the latest progress, and reports nothing for unknown ids', () => {
    const model = new ProgressReadModel();
    model.update('acq-1', { percent: 42, bytesTransferred: 42, bytesTotal: 100 });
    expect(model.get('acq-1')?.percent).toBe(42);
    expect(model.get('unknown')).toBeUndefined();
  });
});

describe('LibraryViewProjection', () => {
  it('lists imported releases with their canonical metadata', () => {
    const projection = new LibraryViewProjection();
    for (const entry of stored(history)) projection.apply(entry);
    expect(projection.list()).toEqual([
      { acquisitionId: 'acq-1', artist: 'Radiohead', title: 'Kid A', location: '/lib/c' },
    ]);
  });

  it('skips an import with no resolved target rather than crashing (fail-safe guard)', () => {
    const projection = new LibraryViewProjection();
    // An Imported event whose stream never recorded a TargetResolved — an ordering invariant that
    // holds in practice; the projection degrades to skipping the entry instead of throwing.
    const entries = stored([{ type: 'Imported', candidate: c.identity, location: '/lib/c' }]);
    for (const entry of entries) {
      projection.apply(entry);
    }
    expect(projection.list()).toEqual([]);
  });
});

describe('StalledReadModel', () => {
  it('marks, reads, and clears stalled acquisitions', () => {
    const model = new StalledReadModel();
    expect(model.isStalled('acq-1')).toBe(false);

    model.mark('acq-1');
    expect(model.isStalled('acq-1')).toBe(true);
    expect(model.isStalled('acq-2')).toBe(false);

    model.clear('acq-1');
    expect(model.isStalled('acq-1')).toBe(false);
  });

  it('clearing an unknown acquisition is a no-op', () => {
    const model = new StalledReadModel();
    expect(() => {
      model.clear('never-marked');
    }).not.toThrow();
  });
});

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
import type { AcquisitionEvent } from '../../domain/acquisition/events.js';
import type { StoredEvent } from '../ports/event-store-port.js';
import {
  awaitingSelectionHistory,
  defaultPolicies,
  matchingCandidate,
  rankedOf,
  sampleEditionCandidates,
  sampleRequest,
  sampleTarget,
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
    verdict: { confidence: 0, reasons: ['DurationMismatch'] },
  },
  { type: 'CandidateRejected', candidate: b.identity },
  { type: 'CandidateSelected', candidate: c },
  { type: 'DownloadCompleted', candidate: c.identity, files: [] },
  { type: 'ValidationPassed', candidate: c.identity, verdict: { confidence: 1, reasons: [] } },
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
    const view = projectStatus('acq-1', history);
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
});

describe('projectStatus — target description', () => {
  it('is absent before any target is known for a musicbrainz request', () => {
    const view = projectStatus('acq-1', [
      { type: 'AcquisitionRequested', request: sampleRequest, policies: defaultPolicies() },
    ]);
    expect(view.target).toBeUndefined();
  });

  it('falls back to the descriptor request before resolution', () => {
    const view = projectStatus('acq-1', [
      {
        type: 'AcquisitionRequested',
        request: { kind: 'descriptor', targetType: 'album', artist: 'Artist', title: 'Album' },
        policies: defaultPolicies(),
      },
    ]);
    expect(view.target).toEqual({ artist: 'Artist', title: 'Album' });
  });
});

describe('projectStatus — awaiting manual edition selection', () => {
  it('exposes the retained candidate editions while awaiting a choice', () => {
    const view = projectStatus('acq-1', awaitingSelectionHistory());
    expect(view.status).toBe('AwaitingManualSelection');
    expect(view.candidates).toEqual(sampleEditionCandidates);
  });

  it('drops the candidates once an edition is selected and the flow resumes', () => {
    const view = projectStatus('acq-1', [
      ...awaitingSelectionHistory(),
      { type: 'EditionSelected', releaseMbid: asMbid('boot-1') },
    ]);
    expect(view.status).toBe('Pending');
    expect(view.candidates).toBeUndefined();
  });
});

describe('projectStatus — an external fulfilment rejection', () => {
  it('is recorded in the history with its reasons', () => {
    const view = projectStatus('acq-1', [
      ...history,
      { type: 'FulfillmentRejected', candidate: c.identity, reasons: ['corrupt stub'] },
    ]);
    expect(view.history.at(-1)).toEqual({
      kind: 'fulfillment-rejected',
      candidate: c.identity,
      reasons: ['corrupt stub'],
    });
  });
});

describe('AcquisitionStatusProjection', () => {
  it('applies events, reads a view, lists, and rebuilds from the log', () => {
    const projection = new AcquisitionStatusProjection();
    const events = stored(history);
    for (const entry of events) projection.apply(entry);

    expect(projection.get('acq-1')?.status).toBe('Fulfilled');
    expect(projection.get('missing')).toBeUndefined();
    expect(projection.list()).toHaveLength(1);

    projection.rebuild(events);
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
    for (const entry of stored([{ type: 'Imported', candidate: c.identity, location: '/lib/c' }])) {
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

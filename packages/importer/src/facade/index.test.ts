import { testContext } from '../application/__fixtures__/correlation.js';
import { OTHER_STORY, STORY } from '../application/__fixtures__/correlation.js';
import { describe, expect, it } from 'vitest';
import { submitImport } from '../application/import/use-cases.js';
import { toOriginatingDownloadId } from '../domain/shared/originating-download-id.js';
import { SOURCE } from '../domain/import/__fixtures__/import-fixtures.js';
import { testWiring } from './__fixtures__/wiring.js';
import type { TestWiring } from './__fixtures__/wiring.js';
import {
  createImporterFacade,
  importListResultSchema,
  importStatusResultSchema,
  importerFacadeErrorSchema,
  resolveReviewResultSchema,
  reviewListResultSchema,
  submitImportResultSchema,
} from './facade.js';
import type { FacadeResult, ImporterFacade } from './facade.js';

/**
 * The wire-shaped facade (module-architecture): every input and output is a plain serializable
 * DTO — round-tripping through JSON must be lossless and still schema-valid — and every expected
 * failure is a modeled error value, never a throw.
 */

const INTAKE = '/intake/Artist - Album';
// The deterministic id `importIdFor(INTAKE)` mints, pinned as a golden literal so the test proves
// the actual derivation rather than re-deriving the expected value with the code under test.
const GOLDEN_IMPORT_ID = 'imp-ab1aa9bf67fc1a5beafaf243';

/** The message a rejected call hands the caller — fails loudly if the call did not fail validation. */
function validationMessage(result: FacadeResult<unknown>): string {
  if (result.ok || result.error.kind !== 'ValidationFailed') {
    throw new Error(`expected a ValidationFailed error, got ${JSON.stringify(result)}`);
  }
  return result.error.message;
}

/** Round-trip a value through JSON and assert nothing was lost. */
function roundTrip<T>(value: T): T {
  // The JSON round-trip is the assertion: this proves the DTO survives wire serialization, which
  // structuredClone (a structured, non-JSON clone) would not exercise.
  // eslint-disable-next-line unicorn/prefer-structured-clone
  const tripped = JSON.parse(JSON.stringify(value)) as T;
  expect(tripped).toEqual(value);
  return tripped;
}

/** Submit through the facade and drive the stubbed propose dispatch, like the reactor would. */
async function submitAndPropose(wiring: TestWiring, facade: ImporterFacade): Promise<string> {
  const submitted = await facade.submitImport({ path: INTAKE }, STORY);
  if (!submitted.ok) throw new Error('submit failed');
  await wiring.dispatch(submitted.value.importId, { type: 'Propose', directory: INTAKE });
  wiring.sync();
  return submitted.value.importId;
}

describe('createImporterFacade', () => {
  describe('submitImport', () => {
    it('accepts a submission and returns the deterministic import id', async () => {
      const facade = createImporterFacade(testWiring().deps);
      const result = await facade.submitImport(
        { path: INTAKE, hints: { mbReleaseId: 'mb-1' } },
        STORY,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(submitImportResultSchema.parse(roundTrip(result.value))).toEqual({
          importId: GOLDEN_IMPORT_ID,
        });
      }
    });

    it('returns a modeled validation error for schema-invalid input, without throwing', async () => {
      const facade = createImporterFacade(testWiring().deps);
      const result = await facade.submitImport({}, STORY);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('ValidationFailed');
        expect(importerFacadeErrorSchema.parse(roundTrip(result.error))).toEqual(result.error);
      }
      // The rejection says what was wrong — the BFF renders this message verbatim, so a blank one
      // would leave the caller with nothing to act on.
      expect(validationMessage(result)).toContain('expected string');
    });

    it('reports every rejected field in one validation message, not only the first', async () => {
      const facade = createImporterFacade(testWiring().deps);
      const result = await facade.submitImport({ path: 7, hints: 'the usual' }, STORY);

      const problems = validationMessage(result).split('; ');
      expect(problems).toHaveLength(2);
      expect(problems[0]).toContain('expected string');
      expect(problems[1]).toContain('expected object');
    });

    it('passes an append race through as a modeled conflict value', async () => {
      const wiring = testWiring();
      wiring.store.conflictOnAppend = true;
      const facade = createImporterFacade(wiring.deps);
      const result = await facade.submitImport({ path: INTAKE }, STORY);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('ConcurrencyConflict');
        expect(importerFacadeErrorSchema.parse(roundTrip(result.error))).toEqual(result.error);
      }
    });

    it('maps an infrastructure fault to a serializable InfraError value (cause stripped)', async () => {
      const wiring = testWiring();
      wiring.store.failReads = true;
      const facade = createImporterFacade(wiring.deps);
      const result = await facade.submitImport({ path: INTAKE }, STORY);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('InfraError');
        expect(result.error).not.toHaveProperty('cause');
        expect(importerFacadeErrorSchema.parse(roundTrip(result.error))).toEqual(result.error);
      }
    });
  });

  describe('resolveReview', () => {
    it('resolves a pending review', async () => {
      const wiring = testWiring();
      const facade = createImporterFacade(wiring.deps);
      const importId = await submitAndPropose(wiring, facade);

      const result = await facade.resolveReview(
        { id: importId, resolution: { verb: 'reject' } },
        STORY,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(resolveReviewResultSchema.parse(roundTrip(result.value))).toEqual({ importId });
      }
    });

    it('returns UnknownImport for an id no stream exists for', async () => {
      const facade = createImporterFacade(testWiring().deps);
      const result = await facade.resolveReview(
        {
          id: 'imp-unknown',
          resolution: { verb: 'reject' },
        },
        STORY,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('UnknownImport');
        expect(importerFacadeErrorSchema.parse(roundTrip(result.error))).toEqual(result.error);
      }
    });

    it('rejects an unknown verb as a modeled validation error', async () => {
      const facade = createImporterFacade(testWiring().deps);
      const result = await facade.resolveReview(
        {
          id: 'imp-1',
          resolution: { verb: 'transmogrify' },
        },
        STORY,
      );

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe('ValidationFailed');
    });
  });

  describe('getImport', () => {
    it('returns the status view for a known import', async () => {
      const wiring = testWiring();
      const facade = createImporterFacade(wiring.deps);
      const importId = await submitAndPropose(wiring, facade);

      const result = facade.getImport({ id: importId });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(importStatusResultSchema.parse(roundTrip(result.value))).toEqual(result.value);
        expect(result.value.importId).toBe(importId);
        expect(result.value.review?.kind).toBe('no-match');
      }
    });

    it('surfaces a dead-lettered import as stalled through the DTO', async () => {
      const wiring = testWiring();
      const facade = createImporterFacade(wiring.deps);
      const importId = await submitAndPropose(wiring, facade);

      wiring.stalled.mark(importId); // the reactor dead-lettered this import's effect

      const result = facade.getImport({ id: importId });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.stalled).toBe(true);
        expect(importStatusResultSchema.parse(roundTrip(result.value))).toEqual(result.value);
      }
    });

    it('returns NotFound for an unknown import', () => {
      const facade = createImporterFacade(testWiring().deps);
      const result = facade.getImport({ id: 'imp-unknown' });

      expect(result).toEqual({ ok: false, error: { kind: 'NotFound' } });
    });

    it('rejects invalid input as a modeled validation error', () => {
      const facade = createImporterFacade(testWiring().deps);
      const result = facade.getImport({ id: '' });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe('ValidationFailed');
    });
  });

  describe('getImportForAcquisition', () => {
    it('returns the view for the acquisition that submitted it, carrying the acquisition id', async () => {
      const wiring = testWiring();
      await submitImport(
        wiring.deps,
        {
          directory: INTAKE,
          source: { acquisitionId: toOriginatingDownloadId('acq-9') },
        },
        testContext(),
      );
      wiring.sync();

      const result = wiring.facade.getImportForAcquisition({ acquisitionId: 'acq-9' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(importStatusResultSchema.parse(roundTrip(result.value))).toEqual(result.value);
        expect(result.value.acquisitionId).toBe('acq-9');
        expect(result.value.importId).toBe(GOLDEN_IMPORT_ID);
      }
    });

    it('returns NotFound for an acquisition with no import', () => {
      const facade = createImporterFacade(testWiring().deps);
      const result = facade.getImportForAcquisition({ acquisitionId: 'acq-none' });

      expect(result).toEqual({ ok: false, error: { kind: 'NotFound' } });
    });

    it('rejects invalid input as a modeled validation error', () => {
      const facade = createImporterFacade(testWiring().deps);
      const result = facade.getImportForAcquisition({ acquisitionId: '' });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe('ValidationFailed');
    });
  });

  describe('collection reads', () => {
    it('lists imports and pending reviews as wire-shaped collections', async () => {
      const wiring = testWiring();
      const facade = createImporterFacade(wiring.deps);
      await submitAndPropose(wiring, facade);

      const imports = facade.listImports();
      const reviews = facade.listPendingReviews();

      expect(importListResultSchema.parse(roundTrip(imports))).toEqual(imports);
      expect(imports.imports).toHaveLength(1);
      expect(reviewListResultSchema.parse(roundTrip(reviews))).toEqual(reviews);
      expect(reviews.reviews).toHaveLength(1);
    });

    it('exposes each pending review’s permitted verb set, gated on a retained candidate', async () => {
      // A manually submitted import (no source, no retained candidate): the retry verb is withheld,
      // plain reject still offered.
      const manual = testWiring();
      await submitAndPropose(manual, manual.facade);
      const manualActions = manual.facade.listPendingReviews().reviews[0]?.availableActions ?? [];
      expect(manualActions).toContain('reject');
      expect(manualActions).not.toContain('reject-unusable-delivery');

      // A downloader-delivered import that retains its candidate: the retry verb joins the set.
      const delivered = testWiring();
      await submitImport(delivered.deps, { directory: INTAKE, source: SOURCE }, testContext());
      await delivered.dispatch(GOLDEN_IMPORT_ID, { type: 'Propose', directory: INTAKE });
      const deliveredActions =
        delivered.facade.listPendingReviews().reviews[0]?.availableActions ?? [];
      expect(deliveredActions).toContain('reject-unusable-delivery');
    });
  });
});

describe('facade correlation carriage', () => {
  it('threads the caller-minted story into the metadata of the events a command appends', async () => {
    const wiring = testWiring();

    // OTHER_STORY, deliberately: the wiring's mint source can only produce STORY, so adopting the
    // caller's story and ignoring it in favour of a fresh mint are distinguishable outcomes here.
    const result = await wiring.facade.submitImport({ path: INTAKE }, OTHER_STORY);

    expect(result.ok).toBe(true);
    const appended = wiring.store.all();
    expect(appended.length).toBeGreaterThan(0);
    for (const entry of appended) {
      expect(entry.metadata.correlationId).toBe(OTHER_STORY);
      expect(entry.metadata.causation).toMatchObject({ kind: 'command' });
    }
  });

  it('degrades to a fresh story rather than refusing work when the caller supplies a malformed id', async () => {
    const wiring = testWiring();

    const result = await wiring.facade.submitImport({ path: INTAKE }, 'not-a-trace-id');

    expect(result.ok).toBe(true);
    const [first] = wiring.store.all();
    expect(first!.metadata.correlationId).not.toBe('not-a-trace-id');
    expect(first!.metadata.correlationId).toMatch(/^[0-9a-f]{32}$/);
  });
});

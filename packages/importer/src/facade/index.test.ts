import { describe, expect, it } from 'vitest';
import { importIdFor, submitImport } from '../application/import/use-cases.js';
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
import type { ImporterFacade } from './facade.js';

/**
 * The wire-shaped facade (module-architecture): every input and output is a plain serializable
 * DTO — round-tripping through JSON must be lossless and still schema-valid — and every expected
 * failure is a modeled error value, never a throw.
 */

const INTAKE = '/intake/Artist - Album';

/** Round-trip a value through JSON and assert nothing was lost. */
function roundTrip<T>(value: T): T {
  const tripped = JSON.parse(JSON.stringify(value)) as T;
  expect(tripped).toEqual(value);
  return tripped;
}

/** Submit through the facade and drive the stubbed propose dispatch, like the reactor would. */
async function submitAndPropose(wiring: TestWiring, facade: ImporterFacade): Promise<string> {
  const submitted = await facade.submitImport({ path: INTAKE });
  if (!submitted.ok) throw new Error('submit failed');
  await wiring.dispatch(submitted.value.importId, { type: 'Propose', directory: INTAKE });
  wiring.sync();
  return submitted.value.importId;
}

describe('createImporterFacade', () => {
  describe('submitImport', () => {
    it('accepts a submission and returns the deterministic import id', async () => {
      const facade = createImporterFacade(testWiring().deps);
      const result = await facade.submitImport({ path: INTAKE, hints: { mbReleaseId: 'mb-1' } });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(submitImportResultSchema.parse(roundTrip(result.value))).toEqual({
          importId: importIdFor(INTAKE),
        });
      }
    });

    it('returns a modeled validation error for schema-invalid input, without throwing', async () => {
      const facade = createImporterFacade(testWiring().deps);
      const result = await facade.submitImport({});

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('ValidationFailed');
        expect(importerFacadeErrorSchema.parse(roundTrip(result.error))).toEqual(result.error);
      }
    });

    it('passes an append race through as a modeled conflict value', async () => {
      const wiring = testWiring();
      wiring.store.conflictOnAppend = true;
      const facade = createImporterFacade(wiring.deps);
      const result = await facade.submitImport({ path: INTAKE });

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
      const result = await facade.submitImport({ path: INTAKE });

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

      const result = await facade.resolveReview({ id: importId, resolution: { verb: 'reject' } });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(resolveReviewResultSchema.parse(roundTrip(result.value))).toEqual({ importId });
      }
    });

    it('returns UnknownImport for an id no stream exists for', async () => {
      const facade = createImporterFacade(testWiring().deps);
      const result = await facade.resolveReview({
        id: 'imp-unknown',
        resolution: { verb: 'reject' },
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('UnknownImport');
        expect(importerFacadeErrorSchema.parse(roundTrip(result.error))).toEqual(result.error);
      }
    });

    it('rejects an unknown verb as a modeled validation error', async () => {
      const facade = createImporterFacade(testWiring().deps);
      const result = await facade.resolveReview({
        id: 'imp-1',
        resolution: { verb: 'transmogrify' },
      });

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
      await submitImport(wiring.deps, { directory: INTAKE, source: { acquisitionId: 'acq-9' } });
      wiring.sync();

      const result = wiring.facade.getImportForAcquisition({ acquisitionId: 'acq-9' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(importStatusResultSchema.parse(roundTrip(result.value))).toEqual(result.value);
        expect(result.value.acquisitionId).toBe('acq-9');
        expect(result.value.importId).toBe(importIdFor(INTAKE));
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
  });
});

import { errAsync, okAsync } from 'neverthrow';
import { describe, expect, it } from 'vitest';
import type { EventStorePort } from '../application/ports/event-store-port.js';
import { testWiring } from './__fixtures__/wiring.js';
import {
  acquisitionListResultSchema,
  acquisitionStatusResultSchema,
  cancelAcquisitionResultSchema,
  createDownloaderFacade,
  downloaderFacadeErrorSchema,
  progressResultSchema,
  submitAcquisitionResultSchema,
} from './facade.js';

/**
 * The wire-shaped facade (module-architecture): every input and output is a plain serializable
 * DTO — round-tripping through JSON must be lossless and still schema-valid — and every expected
 * failure is a modeled error value, never a throw.
 */

const VALID_SUBMIT = {
  request: { kind: 'musicbrainz', mbid: 'mbid-1', targetType: 'album' },
} as const;

/** Round-trip a value through JSON and assert nothing was lost. */
function roundTrip<T>(value: T): T {
  const tripped = JSON.parse(JSON.stringify(value)) as T;
  expect(tripped).toEqual(value);
  return tripped;
}

describe('createDownloaderFacade', () => {
  describe('submitAcquisition', () => {
    it('accepts a valid submission and returns the acquisition id', async () => {
      const facade = createDownloaderFacade(testWiring().deps);
      const result = await facade.submitAcquisition(VALID_SUBMIT);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(submitAcquisitionResultSchema.parse(roundTrip(result.value))).toEqual(result.value);
      }
    });

    it('returns a modeled validation error for schema-invalid input, without throwing', async () => {
      const facade = createDownloaderFacade(testWiring().deps);
      const result = await facade.submitAcquisition({ request: { kind: 'nonsense' } });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('ValidationFailed');
        expect(downloaderFacadeErrorSchema.parse(roundTrip(result.error))).toEqual(result.error);
      }
    });

    it('returns InvalidPolicy for a schema-valid but domain-inconsistent policy', async () => {
      const facade = createDownloaderFacade(testWiring().deps);
      const result = await facade.submitAcquisition({
        ...VALID_SUBMIT,
        qualityPolicy: { order: ['LOSSLESS'], floor: 'LOSSY_LOW' },
      });

      expect(result).toEqual({ ok: false, error: { kind: 'InvalidPolicy' } });
    });

    it('maps an infrastructure fault to a serializable InfraError value (cause stripped)', async () => {
      const wiring = testWiring();
      wiring.store.failReads = true;
      const facade = createDownloaderFacade(wiring.deps);
      const result = await facade.submitAcquisition(VALID_SUBMIT);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('InfraError');
        expect(result.error).not.toHaveProperty('cause');
        expect(downloaderFacadeErrorSchema.parse(roundTrip(result.error))).toEqual(result.error);
      }
    });

    it('passes a store conflict through as a modeled error value', async () => {
      const conflictStore: EventStorePort = {
        append: () =>
          errAsync({ kind: 'ConcurrencyConflict', streamId: 'acq-1', expectedVersion: 0 }),
        readStream: () => okAsync([]),
        readAll: () => okAsync([]),
      };
      const facade = createDownloaderFacade({ ...testWiring().deps, store: conflictStore });
      const result = await facade.submitAcquisition(VALID_SUBMIT);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('ConcurrencyConflict');
        expect(downloaderFacadeErrorSchema.parse(roundTrip(result.error))).toEqual(result.error);
      }
    });
  });

  describe('cancelAcquisition', () => {
    it('cancels a live acquisition', async () => {
      const wiring = testWiring();
      const facade = createDownloaderFacade(wiring.deps);
      const submitted = await facade.submitAcquisition(VALID_SUBMIT);
      if (!submitted.ok) throw new Error('submit failed');

      const result = await facade.cancelAcquisition({ id: submitted.value.acquisitionId });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(cancelAcquisitionResultSchema.parse(roundTrip(result.value))).toEqual({
          acquisitionId: submitted.value.acquisitionId,
        });
      }
    });

    it('converges as a tolerated no-op for an unknown id (the decider guards)', async () => {
      const facade = createDownloaderFacade(testWiring().deps);
      const result = await facade.cancelAcquisition({ id: 'acq-unknown' });

      expect(result).toEqual({ ok: true, value: { acquisitionId: 'acq-unknown' } });
    });

    it('rejects invalid input as a modeled validation error', async () => {
      const facade = createDownloaderFacade(testWiring().deps);
      const result = await facade.cancelAcquisition({ id: '' });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe('ValidationFailed');
    });
  });

  describe('getAcquisition', () => {
    it('returns the status view for a known acquisition', async () => {
      const wiring = testWiring();
      const facade = createDownloaderFacade(wiring.deps);
      const submitted = await facade.submitAcquisition(VALID_SUBMIT);
      if (!submitted.ok) throw new Error('submit failed');
      wiring.sync();

      const result = facade.getAcquisition({ id: submitted.value.acquisitionId });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(acquisitionStatusResultSchema.parse(roundTrip(result.value))).toEqual(result.value);
        expect(result.value.acquisitionId).toBe(submitted.value.acquisitionId);
      }
    });

    it('returns NotFound for an unknown acquisition', () => {
      const facade = createDownloaderFacade(testWiring().deps);
      const result = facade.getAcquisition({ id: 'acq-unknown' });

      expect(result).toEqual({ ok: false, error: { kind: 'NotFound' } });
    });

    it('rejects invalid input as a modeled validation error', () => {
      const facade = createDownloaderFacade(testWiring().deps);
      const result = facade.getAcquisition({ id: '' });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe('ValidationFailed');
    });
  });

  describe('listAcquisitions', () => {
    it('lists acquisitions as a wire-shaped collection', async () => {
      const wiring = testWiring();
      const facade = createDownloaderFacade(wiring.deps);
      const submitted = await facade.submitAcquisition(VALID_SUBMIT);
      if (!submitted.ok) throw new Error('submit failed');
      wiring.sync();

      const result = facade.listAcquisitions();

      expect(acquisitionListResultSchema.parse(roundTrip(result))).toEqual(result);
      expect(result.acquisitions).toHaveLength(1);
    });
  });

  describe('getAcquisitionProgress', () => {
    it('returns progress when the read model has it', () => {
      const wiring = testWiring();
      const facade = createDownloaderFacade(wiring.deps);
      wiring.progress.update('acq-1', {
        percent: 50,
        bytesTransferred: 5,
        bytesTotal: 10,
        queuePosition: 2,
      });

      const result = facade.getAcquisitionProgress({ id: 'acq-1' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(progressResultSchema.parse(roundTrip(result.value))).toEqual(result.value);
      }
    });

    it('returns NotFound when no progress exists', () => {
      const facade = createDownloaderFacade(testWiring().deps);
      const result = facade.getAcquisitionProgress({ id: 'acq-unknown' });

      expect(result).toEqual({ ok: false, error: { kind: 'NotFound' } });
    });

    it('rejects invalid input as a modeled validation error', () => {
      const facade = createDownloaderFacade(testWiring().deps);
      const result = facade.getAcquisitionProgress({ id: '' });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe('ValidationFailed');
    });
  });
});

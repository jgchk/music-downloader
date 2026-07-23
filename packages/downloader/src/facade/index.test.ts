import { errAsync, okAsync } from 'neverthrow';
import { describe, expect, it } from 'vitest';
import type { EventStorePort } from '../application/ports/event-store-port.js';
import {
  awaitingSelectionHistory,
  defaultPolicies,
  sampleEditionCandidates,
  sampleGroupRequest,
} from '../domain/acquisition/__fixtures__/acquisition-fixtures.js';
import { asMbid } from '../domain/shared/__fixtures__/mbid.js';
import { testWiring } from './__fixtures__/wiring.js';
import type { TestWiring } from './__fixtures__/wiring.js';
import {
  acquisitionListResultSchema,
  acquisitionStatusResultSchema,
  cancelAcquisitionResultSchema,
  createDownloaderFacade,
  downloaderFacadeErrorSchema,
  progressResultSchema,
  selectEditionResultSchema,
  submitAcquisitionResultSchema,
} from './facade.js';

/**
 * The wire-shaped facade (module-architecture): every input and output is a plain serializable
 * DTO — round-tripping through JSON must be lossless and still schema-valid — and every expected
 * failure is a modeled error value, never a throw.
 */

// User-supplied mbids cross the facade edge as UUIDs (parsed with parseMbid); tests use real ones.
const MBID_1 = '11111111-1111-4111-8111-111111111111';
const RETAINED_EDITION = '22222222-2222-4222-8222-222222222222';
const OFF_MENU_EDITION = '33333333-3333-4333-8333-333333333333';

const VALID_SUBMIT = {
  request: { kind: 'musicbrainz', mbid: MBID_1, targetType: 'album' },
} as const;

/** Round-trip a value through JSON and assert nothing was lost. */
function roundTrip<T>(value: T): T {
  // The JSON round-trip is the assertion: this proves the DTO survives wire serialization, which
  // structuredClone (a structured, non-JSON clone) would not exercise.
  // eslint-disable-next-line unicorn/prefer-structured-clone
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

    it('rejects a schema-valid but non-UUID MusicBrainz id as a validation error', async () => {
      const facade = createDownloaderFacade(testWiring().deps);
      const result = await facade.submitAcquisition({
        request: { kind: 'musicbrainz', mbid: 'not-a-uuid', targetType: 'album' },
      });

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
    it('maps a cancel-time infrastructure fault to a modeled error value', async () => {
      const wiring = testWiring();
      const facade = createDownloaderFacade(wiring.deps);
      const submitted = await facade.submitAcquisition(VALID_SUBMIT);
      if (!submitted.ok) throw new Error('submit failed');

      wiring.store.failReads = true;
      const result = await facade.cancelAcquisition({ id: submitted.value.acquisitionId });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe('InfraError');
        expect(downloaderFacadeErrorSchema.parse(roundTrip(result.error))).toEqual(result.error);
      }
    });

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

  describe('selectEdition', () => {
    async function awaitingWiring(): Promise<TestWiring> {
      const wiring = testWiring();
      await wiring.store.append(
        'acq-1',
        0,
        [
          {
            type: 'AcquisitionRequested',
            request: sampleGroupRequest,
            policies: defaultPolicies(),
          },
          {
            type: 'ManualSelectionRequested',
            candidates: [{ releaseMbid: asMbid(RETAINED_EDITION), trackCount: 12 }],
          },
        ],
        { acquisitionId: 'acq-1', occurredAt: 't' },
      );
      wiring.sync();
      return wiring;
    }

    it('accepts a retained candidate and resumes the acquisition', async () => {
      const wiring = await awaitingWiring();
      const result = await wiring.facade.selectEdition({
        id: 'acq-1',
        releaseMbid: RETAINED_EDITION,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(selectEditionResultSchema.parse(roundTrip(result.value))).toEqual({
          acquisitionId: 'acq-1',
        });
      }
      expect(wiring.store.all().map((entry) => entry.type)).toContain('EditionSelected');
    });

    it('returns the modeled UnknownEdition rejection for an off-menu choice', async () => {
      const wiring = await awaitingWiring();
      const result = await wiring.facade.selectEdition({
        id: 'acq-1',
        releaseMbid: OFF_MENU_EDITION,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toEqual({ kind: 'UnknownEdition', releaseMbid: OFF_MENU_EDITION });
        expect(downloaderFacadeErrorSchema.parse(roundTrip(result.error))).toEqual(result.error);
      }
    });

    it('returns the modeled IllegalTransition rejection when not awaiting a selection', async () => {
      const wiring = testWiring();
      const submitted = await wiring.facade.submitAcquisition(VALID_SUBMIT);
      if (!submitted.ok) throw new Error('submit failed');

      const result = await wiring.facade.selectEdition({
        id: submitted.value.acquisitionId,
        releaseMbid: RETAINED_EDITION,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatchObject({ kind: 'IllegalTransition', command: 'SelectEdition' });
      }
    });

    it('rejects invalid input as a modeled validation error', async () => {
      const facade = createDownloaderFacade(testWiring().deps);
      const result = await facade.selectEdition({ id: 'acq-1' });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe('ValidationFailed');
    });

    it('rejects a non-UUID releaseMbid as a modeled validation error', async () => {
      const wiring = await awaitingWiring();
      const result = await wiring.facade.selectEdition({ id: 'acq-1', releaseMbid: 'not-a-uuid' });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe('ValidationFailed');
    });
  });

  describe('getAcquisition', () => {
    it('exposes the candidate editions while an acquisition awaits manual selection', async () => {
      const wiring = testWiring();
      await wiring.store.append('acq-1', 0, awaitingSelectionHistory(), {
        acquisitionId: 'acq-1',
        occurredAt: 't',
      });
      wiring.sync();

      const result = wiring.facade.getAcquisition({ id: 'acq-1' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(acquisitionStatusResultSchema.parse(roundTrip(result.value))).toEqual(result.value);
        expect(result.value.status).toBe('AwaitingManualSelection');
        expect(result.value.candidates).toEqual(sampleEditionCandidates);
      }
    });

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

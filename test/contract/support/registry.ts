import type { ZodType } from 'zod';
import {
  mbRecordingSchema,
  mbRecordingSearchSchema,
  mbReleaseSchema,
  mbReleaseSearchSchema,
} from '../../../src/adapters/musicbrainz/schemas.js';
import {
  slskdEventsSchema,
  slskdOptionsSchema,
  slskdSearchResponsesSchema,
  slskdSearchStateSchema,
  slskdTransfersSchema,
} from '../../../src/adapters/slskd/schemas.js';

/**
 * The single contract registry that binds a captured response — a recorded fixture or an E2E
 * WireMock stub — to the schema it must satisfy (change: external-api-contract-tests). Both the
 * fixture-conformance and stub-conformance checks read this map, so a recorded fixture, an E2E
 * double, and the runtime adapter can never disagree about a payload's shape. Endpoints whose
 * response the adapters do not consume (e.g. the transfer-enqueue acknowledgement) are absent by
 * design — there is no contract to hold them to.
 */

/** Recorded-fixture filename → schema. */
export const fixtureSchemas: Record<string, ZodType> = {
  'musicbrainz/release-lookup.json': mbReleaseSchema,
  'musicbrainz/recording-lookup.json': mbRecordingSchema,
  'musicbrainz/release-search.json': mbReleaseSearchSchema,
  'musicbrainz/recording-search.json': mbRecordingSearchSchema,
  'slskd/search-create.json': slskdSearchStateSchema,
  'slskd/search-state.json': slskdSearchStateSchema,
  'slskd/search-responses.json': slskdSearchResponsesSchema,
  'slskd/transfers-poll.json': slskdTransfersSchema,
  'slskd/events.json': slskdEventsSchema,
  'slskd/options.json': slskdOptionsSchema,
};

/** E2E WireMock stub filename → schema. */
export const stubSchemas: Record<string, ZodType> = {
  'musicbrainz/search.json': mbReleaseSearchSchema,
  'musicbrainz/release.json': mbReleaseSchema,
  'slskd/search-create.json': slskdSearchStateSchema,
  'slskd/search-state.json': slskdSearchStateSchema,
  'slskd/search-responses.json': slskdSearchResponsesSchema,
  'slskd/transfers-poll-inprogress.json': slskdTransfersSchema,
  'slskd/transfers-poll-completed.json': slskdTransfersSchema,
  'slskd/events.json': slskdEventsSchema,
  'slskd/options.json': slskdOptionsSchema,
};

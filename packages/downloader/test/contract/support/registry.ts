import type { ZodType } from 'zod';
import {
  mbRecordingSchema,
  mbRecordingSearchSchema,
  mbReleaseGroupBrowseSchema,
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
 * double, and the runtime adapter can never disagree about a payload's shape. Absence here is an
 * ARTIFACT-level statement only ("this recorded body is not consumed"), declared explicitly in
 * the unconsumed lists below — never an endpoint-level one: the same endpoint can have consumed
 * shapes this tier has not yet witnessed (see the note on the enqueue rejection body below).
 */

/** Recorded-fixture filename → schema. */
export const fixtureSchemas: Record<string, ZodType> = {
  'musicbrainz/release-lookup.json': mbReleaseSchema,
  'musicbrainz/recording-lookup.json': mbRecordingSchema,
  'musicbrainz/release-search.json': mbReleaseSearchSchema,
  'musicbrainz/recording-search.json': mbRecordingSearchSchema,
  'musicbrainz/release-group-browse.json': mbReleaseGroupBrowseSchema,
  'musicbrainz/release-group-lookup.json': mbReleaseSchema,
  'musicbrainz/release-group-no-official-browse.json': mbReleaseGroupBrowseSchema,
  'slskd/search-create.json': slskdSearchStateSchema,
  'slskd/search-state.json': slskdSearchStateSchema,
  'slskd/search-responses.json': slskdSearchResponsesSchema,
  'slskd/transfers-poll.json': slskdTransfersSchema,
  'slskd/events.json': slskdEventsSchema,
  'slskd/options.json': slskdOptionsSchema,
};

/**
 * Recorded ARTIFACTS whose response body the adapters do not consume (the request side is still
 * replay-asserted). This is a statement about the artifact, not the endpoint: the transfer-enqueue
 * 201 ack's body is unconsumed, but the SAME endpoint's 4xx rejection body IS consumed
 * (enqueueRejectionReason's peer-unavailable classification) and is unwitnessed pending the
 * slskd-contract-truth change (task 2.3 records it live). Declaring an artifact here lets the
 * conformance suite skip schema validation without a silent early-return: every fixture on disk
 * must appear either in {@link fixtureSchemas} or here, exactly. The moment an adapter consumes
 * one of these responses, MOVE the entry to {@link fixtureSchemas} (and
 * {@link fixtureRequiredFields} where a guard branches on a field) — do not let it linger here.
 */
export const unconsumedResponseFixtures: readonly string[] = ['slskd/transfers-enqueue.json'];

/**
 * E2E stub mappings whose response body the TS adapters do not consume, under the same
 * artifact-granularity rules (and the same removal obligation) as
 * {@link unconsumedResponseFixtures}. The beets MusicBrainz stub is consumed — by beets itself,
 * whose contract is governed by the pinned-beets bridge tier, not by any TS schema this registry
 * could hold it to.
 */
export const unconsumedStubMappings: readonly string[] = [
  'musicbrainz/beets-release-ws2.json', // consumed by beets (Python), governed by the bridge tier's beets pin
  'slskd/search-delete.json', // 204 body-less ack
  'slskd/transfers-delete.json', // 204 body-less ack
  'slskd/transfers-enqueue.json', // 201 empty-body ack; the 4xx rejection body is the slskd-contract-truth 2.3 item
];

/**
 * Consumed fields that must be *present* in a recorded capture, not merely allowed by the
 * (all-optional, tolerant-reader) schema. The adapter's harvest-integrity gates branch on these
 * fields and fail open when one is absent — so a re-record that loses one must fail the tier and
 * force a deliberate decision instead of silently disarming a guard.
 */
export const fixtureRequiredFields: Record<string, readonly string[]> = {
  'slskd/search-state.json': ['isComplete', 'state', 'responseCount'],
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

import type { ZodType } from 'zod';
import {
  mbRecordingSchema,
  mbRecordingSearchSchema,
  mbReleaseGroupBrowseSchema,
  mbReleaseSchema,
  mbReleaseSearchSchema,
} from '../../../src/adapters/musicbrainz/schemas.js';
import {
  slskdEnqueueRejectionSchema,
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
 * shapes recorded under different scenarios (the transfer enqueue's 201 ack carries nothing, while
 * its 500 rejection body is the whole account of a failed enqueue).
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
  // The live-network cross-check: real heterogeneous peers, recorded from the maintainer's slskd.
  // The lab cannot fake a search answered by hundreds of different client implementations, so this
  // set stays as the witness that the lab's shapes are the network's shapes.
  'slskd/live/search-create.json': slskdSearchStateSchema,
  'slskd/live/search-state.json': slskdSearchStateSchema,
  'slskd/live/search-responses.json': slskdSearchResponsesSchema,
  'slskd/live/transfers-poll.json': slskdTransfersSchema,
  'slskd/live/events.json': slskdEventsSchema,
  'slskd/live/options.json': slskdOptionsSchema,
  // The lab's happy path, recorded as one coupled session (search → enqueue → poll → events).
  'slskd/full-flow/search-create.json': slskdSearchStateSchema,
  'slskd/full-flow/search-state.json': slskdSearchStateSchema,
  'slskd/full-flow/search-responses.json': slskdSearchResponsesSchema,
  'slskd/full-flow/transfers-poll.json': slskdTransfersSchema,
  'slskd/full-flow/events.json': slskdEventsSchema,
  'slskd/full-flow/options.json': slskdOptionsSchema,
  // One scenario per transfer state the classifier consumes — all of them the same endpoint, which
  // is why the fixtures are nested by scenario rather than named flat.
  'slskd/queued/transfers-poll.json': slskdTransfersSchema,
  'slskd/cancelled/transfers-poll.json': slskdTransfersSchema,
  'slskd/rejection/transfers-poll.json': slskdTransfersSchema,
  'slskd/errored/transfers-poll.json': slskdTransfersSchema,
  // The enqueue rejections, whose *body* is the consumed contract — there is no transfer row to
  // read for the offline and stalled cases, so this text is the entire account of the failure.
  // (On the pinned slskd these arrive as 500s and take the infrastructure path first; the
  // classifier reads them for diagnostics only — see `enqueueRejectionReason`.)
  'slskd/rejection/transfers-enqueue.json': slskdEnqueueRejectionSchema,
  'slskd/offline/transfers-enqueue.json': slskdEnqueueRejectionSchema,
  'slskd/unreachable/transfers-enqueue.json': slskdEnqueueRejectionSchema,
  'slskd/stalled/transfers-enqueue.json': slskdEnqueueRejectionSchema,
};

/**
 * Recorded ARTIFACTS whose response body the adapters do not consume (the request side is still
 * replay-asserted). This is a statement about the artifact, not the endpoint: the transfer-enqueue
 * 201 ack carries nothing, while the SAME endpoint's 500 rejection body is consumed contract and is
 * schema-bound above. Declaring an artifact here lets the conformance suite skip schema validation
 * without a silent early-return: every fixture on disk must appear either in
 * {@link fixtureSchemas} or here, exactly. The moment an adapter consumes one of these responses,
 * MOVE the entry to {@link fixtureSchemas} (and {@link fixtureRequiredFields} where a guard
 * branches on a field) — do not let it linger here.
 */
export const unconsumedResponseFixtures: readonly string[] = [
  'slskd/live/transfers-enqueue.json', // 201 empty-body ack
  'slskd/full-flow/transfers-enqueue.json', // 201 empty-body ack
  'slskd/queued/transfers-enqueue.json', // 201 empty-body ack
  'slskd/full-flow/search-delete.json', // 204 body-less ack
  'slskd/cancelled/transfers-cancel.json', // 204 body-less ack
  // A 404 with no body at all. The *status* is consumed — it is how the adapter learns a user has
  // no transfers, which is state and not a fault — but there is nothing to validate a schema
  // against, so the meaning is pinned by the replay test instead.
  'slskd/absent/transfers-poll.json',
  // The queue-position endpoint answers a bare integer. Recorder-only surface: it exists to make
  // `placeInQueue` appear in the poll that follows it (slskd only asks the peer when something
  // calls this), and no adapter reads its response — which is also why it is absent from the
  // consumed-operations manifest.
  'slskd/queued/transfers-position.json',
];

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
  'slskd/transfers-enqueue.json', // 201 empty-body ack (the rejection body is witnessed by the recorded lab fixtures)
];

/**
 * Consumed fields that must be *present* in a recorded capture, not merely allowed by the
 * (all-optional, tolerant-reader) schema. The adapter's harvest-integrity gates branch on these
 * fields and fail open when one is absent — so a re-record that loses one must fail the tier and
 * force a deliberate decision instead of silently disarming a guard.
 */
export const fixtureRequiredFields: Record<string, readonly string[]> = {
  'slskd/live/search-state.json': ['isComplete', 'state', 'responseCount'],
  'slskd/full-flow/search-state.json': ['isComplete', 'state', 'responseCount'],
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

/**
 * Scripted E2E stub filename → schema. These live under `test/e2e/stubs/<service>/scripted/`
 * (NOT `mappings/`, so WireMock never auto-loads them): a phase registers them ad hoc via the
 * admin API — the review-resolution phase's second-hunt script. They are files precisely so
 * this registry can hold them to the same contract as the permanent stubs; response-less
 * mappings (204s) and the unconsumed enqueue ack are absent by design.
 */
export const scriptedStubSchemas: Record<string, ZodType> = {
  'slskd/scripted/search-create-round1.json': slskdSearchStateSchema,
  'slskd/scripted/search-create-round2.json': slskdSearchStateSchema,
  'slskd/scripted/search2-state-held.json': slskdSearchStateSchema,
  'slskd/scripted/search2-state-complete.json': slskdSearchStateSchema,
  'slskd/scripted/search2-responses.json': slskdSearchResponsesSchema,
  'slskd/scripted/peer2-transfers-poll.json': slskdTransfersSchema,
  'slskd/scripted/events-both-completes.json': slskdEventsSchema,
};

/**
 * Scripted stubs deliberately outside the conformance map: response-less mappings (204s) and
 * the enqueue acknowledgement no adapter consumes. Every file in the scripted directory must
 * appear either here or in `scriptedStubSchemas` — enforced by the exhaustiveness check in
 * fixtures.contract.test.ts, so a future scripted stub cannot dodge the contract silently.
 */
export const scriptedStubsWithoutContract: readonly string[] = [
  'slskd/scripted/peer2-enqueue.json',
  'slskd/scripted/peer2-transfer-delete.json',
  'slskd/scripted/search2-delete.json',
];

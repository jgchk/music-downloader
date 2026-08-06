import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MusicBrainzMetadata } from '../../src/adapters/musicbrainz/metadata.js';
import {
  releaseGroupCandidateIds,
  releaseGroupEditionCandidates,
} from '../../src/adapters/musicbrainz/mapping.js';
import {
  mbRecordingSearchSchema,
  mbReleaseGroupBrowseSchema,
} from '../../src/adapters/musicbrainz/schemas.js';
import type { AcquisitionRequest } from '../../src/domain/acquisition/events.js';
import type { Mbid } from '../../src/domain/shared/mbid.js';
import { asMbid } from '../../src/domain/shared/__fixtures__/mbid.js';
import { silentLogger } from '../../src/application/__fixtures__/fakes.js';
import { loadFixtures } from './support/fixture.js';
import type { ContractFixture } from './support/fixture.js';
import { startFixtureServer } from './support/server.js';
import type { FixtureServer } from './support/server.js';

/**
 * Tier 1 for the MusicBrainz adapter (task 3.2): the real {@link MusicBrainzMetadata}, over real
 * `fetch`, resolves against a local server serving the recorded fixtures. It asserts both that the
 * adapter consumes contract-conforming responses correctly and that the requests it sends — path,
 * query, and identification headers — match what was recorded from the live service.
 */

const USER_AGENT = 'music-downloader-contract-test/0.0';

const fixtures = loadFixtures('musicbrainz');
const byName = (name: string): ContractFixture => {
  const hit = fixtures.find((f) => f.name === name);
  if (hit === undefined) throw new Error(`missing fixture ${name}`);
  return hit.fixture;
};

const mbidFromPath = (name: string): Mbid => asMbid(byName(name).request.path.split('/').at(-1)!);

let server: FixtureServer;

function adapter(): MusicBrainzMetadata {
  return new MusicBrainzMetadata(silentLogger(), undefined, {
    baseUrl: server.baseUrl,
    userAgent: USER_AGENT,
  });
}

beforeEach(async () => {
  server = await startFixtureServer(fixtures);
});
afterEach(async () => {
  await server.close();
});

describe('MusicBrainz contract (tier 1)', () => {
  it('resolves a release by MBID and requests the recorded path, query, and headers', async () => {
    const mbid = mbidFromPath('release-lookup.json');
    const request: AcquisitionRequest = { kind: 'musicbrainz', mbid, targetType: 'album' };

    const resolution = await adapter().resolve(request);
    const result = resolution._unsafeUnwrap();

    expect(result).toMatchObject({ kind: 'resolved', target: { type: 'album', mbid } });

    const sent = server.requests.find((r) => r.path === `/release/${mbid}`)!;
    expect(sent.method).toBe('GET');
    expect(sent.query).toEqual(byName('release-lookup.json').request.query);
    expect(sent.headers['user-agent']).toBe(USER_AGENT);
    expect(sent.headers.accept).toBe('application/json');
  });

  it('resolves a recording by MBID from the recorded lookup', async () => {
    const mbid = mbidFromPath('recording-lookup.json');
    const request: AcquisitionRequest = { kind: 'musicbrainz', mbid, targetType: 'track' };

    const resolution = await adapter().resolve(request);
    const result = resolution._unsafeUnwrap();

    expect(result).toMatchObject({ kind: 'resolved', target: { type: 'track', mbid } });
    const sent = server.requests.find((r) => r.path === `/recording/${mbid}`)!;
    expect(sent.query).toEqual(byName('recording-lookup.json').request.query);
  });

  // For an album descriptor the adapter groups the real hits by release group and selects an edition
  // within the confident identity. This famous album's recorded hits are all editions of one release
  // group, so it resolves (where the old flat guard read the edition ties as ambiguity). The test
  // pins that the adapter sends the recorded search query, attempts the canonical pick first, and
  // resolves the release it can fetch. Both ids are pinned from the recorded bytes, not computed by
  // the mapping under test: a regression that changes the canonical pick must fail here.
  it('sends the recorded release search and resolves the famous album by grouping its editions', async () => {
    // The earliest official edition of the recorded search's one confident release group — the
    // adapter's canonical first fetch attempt.
    const CANONICAL_FIRST_PICK = '586ff28d-c0fc-4a50-ba18-d7152680417d';
    // The edition the fixture server can actually serve (release-lookup.json); the adapter walks
    // the candidate list until this one fetches.
    const RESOLVED_EDITION = 'be701edc-c9c7-484a-9ed2-aeef051c19be';
    expect(mbidFromPath('release-lookup.json')).toBe(RESOLVED_EDITION);

    const resolution = await adapter().resolve({
      kind: 'descriptor',
      targetType: 'album',
      artist: 'Pink Floyd',
      title: 'The Dark Side of the Moon',
    });
    const result = resolution._unsafeUnwrap();

    const search = server.requests.find((r) => r.path === '/release')!;
    expect(search.query).toMatchObject(byName('release-search.json').request.query!);
    expect(server.requests.some((r) => r.path === `/release/${CANONICAL_FIRST_PICK}`)).toBe(true);
    expect(result).toMatchObject({
      kind: 'resolved',
      target: { type: 'album', mbid: RESOLVED_EDITION },
    });
  });

  it('sends the recorded recording search and applies the ambiguity guard to real hits', async () => {
    // The recorded search returns five 100-score ties for this famous track, so the ambiguity
    // guard must refuse to pick — pinned as the literal recorded outcome, not recomputed via the
    // mapping under test (which would follow a guard regression instead of catching it).
    const { recordings } = mbRecordingSearchSchema.parse(
      byName('recording-search.json').response.body,
    );
    expect(recordings).toHaveLength(5);
    expect(recordings?.every((recording) => recording.score === 100)).toBe(true);

    const resolution = await adapter().resolve({
      kind: 'descriptor',
      targetType: 'track',
      artist: 'Nirvana',
      title: 'Smells Like Teen Spirit',
    });
    const result = resolution._unsafeUnwrap();

    const search = server.requests.find((r) => r.path === '/recording')!;
    expect(search.query).toMatchObject(byName('recording-search.json').request.query!);
    expect(result).toEqual({ kind: 'unresolved' });
  });
});

// The release-group browse shares the `/release` path with the release search, and the fixture
// server routes by path alone, so this tier seeds a server with only the release-group fixtures.
describe('MusicBrainz release-group contract (tier 1)', () => {
  const browseEntry = fixtures.find((f) => f.name === 'release-group-browse.json')!;
  const lookupEntry = fixtures.find((f) => f.name === 'release-group-lookup.json')!;
  const releaseGroupMbid = asMbid(browseEntry.fixture.request.query!['release-group']!);

  let rgServer: FixtureServer;
  beforeEach(async () => {
    rgServer = await startFixtureServer([browseEntry, lookupEntry]);
  });
  afterEach(async () => {
    await rgServer.close();
  });

  function rgAdapter(): MusicBrainzMetadata {
    return new MusicBrainzMetadata(silentLogger(), undefined, {
      baseUrl: rgServer.baseUrl,
      userAgent: USER_AGENT,
    });
  }

  it('browses the group and resolves the picker-selected edition from real data', async () => {
    // over the recorded browse, the picker selects the modal-official-track-count edition
    const editions = mbReleaseGroupBrowseSchema.parse(browseEntry.fixture.response.body).releases;
    const candidates = releaseGroupCandidateIds(editions);
    const pickedId = lookupEntry.fixture.request.path.split('/').at(-1)!;
    expect(candidates[0]).toBe(pickedId);

    const request: AcquisitionRequest = {
      kind: 'release-group',
      mbid: releaseGroupMbid,
      targetType: 'album',
    };
    const resolution = await rgAdapter().resolve(request);
    const result = resolution._unsafeUnwrap();

    const browse = rgServer.requests.find((r) => r.path === '/release')!;
    expect(browse.query).toMatchObject(browseEntry.fixture.request.query!);
    expect(browse.headers['user-agent']).toBe(USER_AGENT);
    expect(rgServer.requests.some((r) => r.path === `/release/${pickedId}`)).toBe(true);
    expect(result).toMatchObject({ kind: 'resolved', target: { type: 'album', mbid: pickedId } });
  });
});

// A group whose recorded editions are all non-official (manual-edition-selection): the adapter must
// offer them for manual choice instead of resolving or failing — and fetch no edition lookup.
describe('MusicBrainz release-group no-official contract (tier 1)', () => {
  const browseEntry = fixtures.find((f) => f.name === 'release-group-no-official-browse.json')!;
  const releaseGroupMbid = asMbid(browseEntry.fixture.request.query!['release-group']!);

  let rgServer: FixtureServer;
  beforeEach(async () => {
    rgServer = await startFixtureServer([browseEntry]);
  });
  afterEach(async () => {
    await rgServer.close();
  });

  it('yields needsSelection with the candidate editions from real data', async () => {
    const releases = mbReleaseGroupBrowseSchema.parse(browseEntry.fixture.response.body).releases;
    // the recorded case: editions exist, none official
    expect(releaseGroupCandidateIds(releases)).toEqual([]);
    const expected = releaseGroupEditionCandidates(releases);
    expect(expected.length).toBeGreaterThan(0);

    const adapter = new MusicBrainzMetadata(silentLogger(), undefined, {
      baseUrl: rgServer.baseUrl,
      userAgent: USER_AGENT,
    });
    const resolution = await adapter.resolve({
      kind: 'release-group',
      mbid: releaseGroupMbid,
      targetType: 'album',
    });
    const result = resolution._unsafeUnwrap();

    const browse = rgServer.requests.find((r) => r.path === '/release')!;
    expect(browse.query).toMatchObject(browseEntry.fixture.request.query!);
    expect(browse.headers['user-agent']).toBe(USER_AGENT);
    // no edition lookup happens: the pause carries presentation values, not fetched targets
    expect(rgServer.requests).toHaveLength(1);
    expect(result).toEqual({ kind: 'needsSelection', candidates: expected });

    // Anchors against independently recorded facts (not the mapping's own output): the 1969 US
    // vinyl is the earliest modal-track-count edition of the recorded browse, and none of the
    // five recorded editions may be dropped.
    const candidates = (result as Extract<typeof result, { kind: 'needsSelection' }>).candidates;
    expect(candidates).toHaveLength(5);
    expect(candidates[0]).toMatchObject({
      releaseMbid: 'df92850f-2a3e-44ba-bdb2-d3d96beea3ae',
      date: '1969',
      country: 'US',
      trackCount: 24,
    });
    expect(candidates.some((candidate) => candidate.format !== undefined)).toBe(true);
    expect(candidates.every((candidate) => candidate.releaseMbid.length > 0)).toBe(true);
  });
});

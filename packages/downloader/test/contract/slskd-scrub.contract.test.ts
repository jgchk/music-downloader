import { describe, expect, it } from 'vitest';
import {
  assertPinnedVersion,
  createAnonymizer,
  projectEvents,
  projectOptions,
} from './record/slskd-support.js';

/**
 * The recorders are the one part of this tier that runs by hand, against real services, and writes
 * into a public repository — so their scrub is the only thing standing between a real Soulseek
 * peer's identity and a git history. It had no tests: the recorder modules sit outside the coverage
 * gate (which scopes to `src/`) and nothing in `pnpm check` executed a line of them.
 *
 * That is exactly how the leak in this project's history happened — a projection that was a special
 * case rather than the default. These are pure functions; holding them here costs nothing and means
 * a re-record cannot quietly stop scrubbing.
 */

describe('the recording scrub', () => {
  it('anonymizes a username wherever it appears, not only where it is a field', () => {
    const { sanitize } = createAnonymizer();

    const scrubbed = sanitize({
      username: 'realperson',
      exception: 'User realperson appears to be offline',
    }) as { username: string; exception: string };

    expect(scrubbed.username).toBe('peer1');
    expect(scrubbed.exception).toBe('User peer1 appears to be offline');
  });

  it('registers every username before rewriting anything', () => {
    // A real search response puts `username` LAST, after the files it shares. A single
    // left-to-right pass would scrub those filenames against an alias map that did not yet know
    // the peer — publishing the name it was supposed to remove.
    const { sanitize } = createAnonymizer();

    const scrubbed = sanitize({
      files: [{ filename: String.raw`@@tok\realperson\album\01.flac` }],
      username: 'realperson',
    }) as { files: { filename: string }[] };

    expect(scrubbed.files[0]!.filename).not.toContain('realperson');
  });

  it('rewrites the longest matching name first', () => {
    // With `bob` handled before `bobby`, scrubbing `bobby` leaves `peer1by` — a corrupted capture
    // that still looks plausible.
    const { alias, sanitize } = createAnonymizer();
    alias('bob');
    alias('bobby');

    expect(sanitize({ exception: 'User bobby appears to be offline' })).toEqual({
      exception: 'User peer2 appears to be offline',
    });
  });

  it('redacts a peer network endpoint', () => {
    const { sanitize } = createAnonymizer();

    expect(sanitize({ exception: 'connection to someone (203.0.113.7:50300)' })).toEqual({
      exception: 'connection to someone (<peer-address>)',
    });
  });

  it('normalizes the per-peer share-token prefix', () => {
    const { sanitize } = createAnonymizer();

    expect(sanitize({ filename: String.raw`@@abcd\Artist\Album\01.flac` })).toEqual({
      filename: String.raw`@@share\Artist\Album\01.flac`,
    });
  });

  it('keeps only the consumed options subtree, dropping the credentials beside it', () => {
    expect(
      projectOptions({
        directories: { downloads: '/app/downloads', incomplete: '/app/incomplete' },
        soulseek: { username: 'realperson', password: 'hunter2' },
      }),
    ).toEqual({ directories: { downloads: '/app/downloads', incomplete: '/app/incomplete' } });
  });

  it('trims each event to the two fields the staged-path resolver reads', () => {
    const kept = projectEvents(
      [
        {
          timestamp: 't',
          type: 'DownloadFileComplete',
          data: JSON.stringify({
            localFilename: '/app/downloads/a.flac',
            remoteFilename: String.raw`@@tok\realperson\a.flac`,
            transfer: { id: 'abc12345-0000', username: 'realperson' },
          }),
        },
      ],
      3,
    ) as { data: string }[];

    expect(kept).toHaveLength(1);
    expect(kept[0]!.data).not.toContain('realperson');
    expect(JSON.parse(kept[0]!.data)).toEqual({
      localFilename: '/app/downloads/a.flac',
      transfer: { id: 'abc12345-0000' },
    });
  });

  it('drops events of any other type', () => {
    expect(projectEvents([{ type: 'SomethingElse', data: '{}' }], 3)).toEqual([]);
  });

  it('refuses to write an events capture that misses the transfer it claims to witness', () => {
    // The coupling `full-flow` exists to guarantee: taking the newest few completions and hoping is
    // how a fixture ends up claiming a coupling it never recorded.
    expect(() =>
      projectEvents(
        [
          {
            type: 'DownloadFileComplete',
            data: JSON.stringify({ localFilename: '/a.flac', transfer: { id: 'other' } }),
          },
        ],
        3,
        'wanted-id',
      ),
    ).toThrow(/wanted-id/);
  });
});

describe('the recording version guard', () => {
  const application = (version: unknown) => () =>
    Promise.resolve({ status: 200, body: { version } });

  it('records against the version the fixtures will claim', async () => {
    await expect(
      assertPinnedVersion(application({ current: '0.22.5.0' })),
    ).resolves.toBeUndefined();
  });

  it('refuses to record against a different version', async () => {
    // Without this, following the documented bump procedure produces a full set of fresh fixtures
    // all stamped with the old version — green, and a lie about the one thing a fixture's meaning
    // depends on.
    await expect(assertPinnedVersion(application({ current: '0.26.0.0' }))).rejects.toThrow(
      /0\.26\.0\.0/,
    );
  });

  it('refuses to record when the instance does not report a version at all', async () => {
    await expect(assertPinnedVersion(application(undefined))).rejects.toThrow(/could not read/);
  });
});

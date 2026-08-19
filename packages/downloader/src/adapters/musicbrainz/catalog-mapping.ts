import { parseMbid } from '../../domain/shared/mbid.js';
import { releaseGroupEditionIds } from './mapping.js';
import type { ReleaseGroupEdition } from './mapping.js';
import type { Mbid } from '../../domain/shared/mbid.js';
import type {
  CatalogEdition,
  CatalogEditionGroup,
  CatalogEditionListing,
  CatalogReleaseGroup,
  CatalogTrack,
} from '../../application/ports/catalog-search-port.js';
import type { ScoredArtist, ScoredRecording, ScoredReleaseGroup } from './ranking.js';
import type {
  MbArtistSearch,
  MbCatalogRecordingSearch,
  MbRelease,
  MbReleaseGroupBrowse,
  MbReleaseGroupSearch,
} from './schemas.js';

/**
 * Pure JSON → catalog mapping for the search read, the presentation-side twin of `mapping.ts`.
 *
 * The governing rule is that a SEARCH HIT only survives if a person could act on it: an entry the
 * catalog gives no usable identifier or no name is dropped rather than rendered as a blank row you
 * cannot request. Editions are kept on identifier alone — they are read inside a thing
 * the person already chose, where an unnamed row is still positional context. Everything else
 * degrades softly: an unknown year, type, or credit is simply absent, because MusicBrainz reporting
 * "unknown" is data, not drift.
 */

/** Join a credit the way the catalog renders it, so `A & B` survives as one line. */
function joinCredit(
  credits: readonly { name?: string | null; joinphrase?: string | null }[] | undefined,
): string {
  return (credits ?? []).map((credit) => `${credit.name ?? ''}${credit.joinphrase ?? ''}`).join('');
}

/** A four-digit leading year, whether the date is `1986`, `1986-08`, or `1986-08-25`. */
function yearOf(date: string | null | undefined): number | undefined {
  const match = /^(\d{4})/.exec(date ?? '');
  return match === null ? undefined : Number(match[1]);
}

/**
 * An identifier the catalog handed us — parsed, never trusted. A hit whose id is not a well-formed
 * mbid is a hit we could not fetch or request later, so it is dropped at the boundary.
 */
function mbidOf(id: string | undefined): Mbid | undefined {
  if (id === undefined) return undefined;
  const parsed = parseMbid(id);
  return parsed.isOk() ? parsed.value : undefined;
}

/** A title/name that survives only if it is a non-empty string — a blank row is not presentable. */
function nameOf(value: string | null | undefined): string | undefined {
  const trimmed = (value ?? '').trim();
  return trimmed === '' ? undefined : trimmed;
}

export function toReleaseGroups(json: MbReleaseGroupSearch): readonly ScoredReleaseGroup[] {
  const groups: ScoredReleaseGroup[] = [];
  const hits = json['release-groups'] ?? [];
  for (const hit of hits) {
    const mbid = mbidOf(hit.id);
    const title = nameOf(hit.title);
    if (mbid === undefined || title === undefined) continue;
    groups.push({
      mbid,
      title,
      artistCredit: joinCredit(hit['artist-credit']),
      year: yearOf(hit['first-release-date']),
      primaryType: nameOf(hit['primary-type']),
      secondaryTypes: hit['secondary-types'] ?? [],
      score: hit.score ?? 0,
    });
  }
  return groups;
}

export function toArtists(json: MbArtistSearch): readonly ScoredArtist[] {
  const artists: ScoredArtist[] = [];
  const hits = json.artists ?? [];
  for (const hit of hits) {
    const mbid = mbidOf(hit.id);
    const name = nameOf(hit.name);
    if (mbid === undefined || name === undefined) continue;
    artists.push({
      mbid,
      name,
      // Both facts, each as itself. They answer the same question a searcher asks of two
      // same-named artists, but which to show is the reader's call, not this read's.
      disambiguation: nameOf(hit.disambiguation),
      type: nameOf(hit.type),
      score: hit.score ?? 0,
    });
  }
  return artists;
}

export function toRecordings(json: MbCatalogRecordingSearch): readonly ScoredRecording[] {
  const recordings: ScoredRecording[] = [];
  const hits = json.recordings ?? [];
  for (const hit of hits) {
    const mbid = mbidOf(hit.id);
    const title = nameOf(hit.title);
    if (mbid === undefined || title === undefined) continue;
    // The first ADDRESSABLE release the catalog names is the one shown for artwork and context —
    // an unaddressable one is walked past — and a recording that names none is still a
    // requestable track.
    const release = (hit.releases ?? [])
      .map((candidate) => {
        const releaseMbid = mbidOf(candidate.id);
        return releaseMbid === undefined
          ? undefined
          : { mbid: releaseMbid, title: nameOf(candidate.title) ?? '' };
      })
      .find((candidate) => candidate !== undefined);
    recordings.push({
      mbid,
      title,
      artistCredit: joinCredit(hit['artist-credit']),
      release,
      score: hit.score ?? 0,
    });
  }
  return recordings;
}

const ALBUM_FIRST = new Set(['Album']);

/**
 * An artist's body of work as a person browses it: albums first — that is what "their records"
 * means — then everything else, newest first within each group so the recent work leads.
 */
export function toDiscography(json: MbReleaseGroupSearch): readonly CatalogReleaseGroup[] {
  // Keys are read once per group rather than on every comparison, which a comparator would do
  // O(n log n) times.
  return toReleaseGroups(json)
    .map((group) => ({
      group,
      albumFirst: ALBUM_FIRST.has(group.primaryType ?? '') ? 0 : 1,
      year: group.year ?? 0,
    }))
    .toSorted((left, right) => left.albumFirst - right.albumFirst || right.year - left.year)
    .map((keyed) => keyed.group);
}

/**
 * An edition's total track count — the sum of its media's counts — or nothing at all when the
 * catalog states no count for any medium. "The catalog does not say" is not "zero tracks": a
 * pressing with no stated count still has a tracklist, and saying `0` would both print a falsehood
 * and heap every uncounted pressing into one group.
 */
function trackCountOf(release: {
  media?: readonly { 'track-count'?: number }[];
}): number | undefined {
  const counts = (release.media ?? [])
    .map((medium) => medium['track-count'])
    .filter((count): count is number => typeof count === 'number');
  return counts.length === 0 ? undefined : counts.reduce((sum, count) => sum + count, 0);
}

/**
 * The distinct media formats of one edition. A list rather than a joined string: the separator is a
 * presentation choice, and a consumer that wants to filter or badge by format should not have to
 * split one back apart.
 */
function formatsOf(release: { media?: readonly { format?: string | null }[] }): readonly string[] {
  const formats = (release.media ?? [])
    .map((medium) => medium.format)
    .filter((format): format is string => typeof format === 'string' && format !== '');
  return [...new Set(formats)];
}

/**
 * A release group's editions, grouped by the choice that actually changes the download — which
 * tracklist — with the most-published tracklist first so the canonical album leads. The default is
 * not decided here: it is asked of {@link releaseGroupEditionIds}, the pipeline's own picker, so the
 * POLICY cannot drift from the behavior it previews. The inputs can differ in one edge case — the
 * preview drops releases whose id is not a well-formed mbid, where the pipeline keeps them. A group
 * whose editions admit no automatic pick says so rather than nominating one.
 */
export function toEditionListing(json: MbReleaseGroupBrowse): CatalogEditionListing {
  const releases = json.releases ?? [];
  const editions: CatalogEdition[] = [];
  const pickable: ReleaseGroupEdition<Mbid>[] = [];

  for (const release of releases) {
    const mbid = mbidOf(release.id);
    if (mbid === undefined) continue;
    const trackCount = trackCountOf(release);
    editions.push({
      mbid,
      title: nameOf(release.title) ?? '',
      disambiguation: nameOf(release.disambiguation),
      date: nameOf(release.date),
      country: nameOf(release.country),
      formats: formatsOf(release),
      status: nameOf(release.status),
      trackCount,
    });
    pickable.push({
      id: mbid,
      status: release.status ?? undefined,
      date: release.date ?? undefined,
      trackCount,
    });
  }

  // A group is created by putting an edition in it, so the edition that created it IS its
  // representative — established here rather than inferred by indexing later, which is what lets
  // every reader treat a group as something that certainly has a tracklist to show.
  // Keyed by the count as a FACT: every uncounted edition shares one key of its own rather than
  // being filed under "zero tracks" alongside them.
  const byTrackCount = new Map<
    number | 'unstated',
    { readonly representative: CatalogEdition; readonly editions: CatalogEdition[] }
  >();
  for (const edition of editions) {
    const key = edition.trackCount ?? 'unstated';
    const group = byTrackCount.get(key);
    if (group === undefined) {
      byTrackCount.set(key, { representative: edition, editions: [edition] });
    } else {
      group.editions.push(edition);
    }
  }

  const groups: readonly CatalogEditionGroup[] = byTrackCount
    .values()
    .map((grouped) => ({
      representative: grouped.representative,
      editions: grouped.editions,
      // Read once here rather than in the comparator, which would read it O(n log n) times. An
      // unstated count sorts last: a group nobody can describe must never lead the listing.
      order: grouped.representative.trackCount ?? Number.MAX_SAFE_INTEGER,
    }))
    .toArray()
    // Most-published tracklist first (the canonical one); ties by track count keep the listing
    // stable rather than depending on which edition the catalog happened to return first.
    .toSorted(
      (left, right) => right.editions.length - left.editions.length || left.order - right.order,
    )
    .map(({ representative, editions: grouped }) => ({ representative, editions: grouped }));

  // The picker carries the id type it was given, so the pick is an `Mbid` because the editions
  // handed to it were — no assertion reinstating a brand nothing checked.
  const [pick] = releaseGroupEditionIds(pickable);
  return {
    groups,
    bestMatch: pick === undefined ? { kind: 'selectionRequired' } : { kind: 'pick', mbid: pick },
  };
}

/**
 * One edition's running order, numbered by reading order across every medium.
 *
 * The catalog numbers tracks WITHIN a medium, so a two-disc release states 1…11 and then 1…10
 * again. This type means one continuous running order — the thing a person reads down — so the
 * position is assigned here rather than passed through: passing it through would hand every
 * consumer two tracks numbered 1 and no way to tell them apart.
 */
export function toTracks(release: MbRelease): readonly CatalogTrack[] {
  const tracks: CatalogTrack[] = [];
  const media = release.media ?? [];
  for (const medium of media) {
    const mediumTracks = medium.tracks ?? [];
    for (const track of mediumTracks) {
      const title = nameOf(track.title) ?? nameOf(track.recording?.title) ?? '';
      const length = track.length ?? track.recording?.length ?? undefined;
      tracks.push({ position: tracks.length + 1, title, durationMs: length ?? undefined });
    }
  }
  return tracks;
}

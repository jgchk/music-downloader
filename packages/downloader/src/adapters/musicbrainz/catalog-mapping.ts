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
 * The governing rule is that a hit only survives if a person could act on it: an entry the catalog
 * gives no usable identifier or no name is dropped rather than rendered as a blank row you cannot
 * request. Everything else degrades softly — an unknown year, type, or credit is simply absent,
 * because MusicBrainz reporting "unknown" is data, not drift.
 */

/** Join a credit the way the catalog renders it, so `A & B` survives as one line. */
function joinCredit(credits: readonly { name?: string | null; joinphrase?: string | null }[] | undefined): string {
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
      // The catalog's own tie-breaker when it has one, else what kind of act this is — both answer
      // the same question a searcher is asking of two same-named artists.
      disambiguation: nameOf(hit.disambiguation) ?? nameOf(hit.type),
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
    // The first release the catalog names is the one shown for artwork and context; a recording
    // that names none (or names one we cannot address) is still a requestable track.
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
 * means — then everything else, newest first inside each band so the recent work leads.
 */
export function toDiscography(json: MbReleaseGroupSearch): readonly CatalogReleaseGroup[] {
  return toReleaseGroups(json).toSorted((left, right) => {
    const leftAlbum = ALBUM_FIRST.has(left.primaryType ?? '') ? 0 : 1;
    const rightAlbum = ALBUM_FIRST.has(right.primaryType ?? '') ? 0 : 1;
    if (leftAlbum !== rightAlbum) return leftAlbum - rightAlbum;
    return (right.year ?? 0) - (left.year ?? 0);
  });
}

/** An edition's total track count: the sum of its media's counts (an unknown count adds nothing). */
function trackCountOf(release: { media?: readonly { 'track-count'?: number }[] }): number {
  return (release.media ?? []).reduce((sum, medium) => sum + (medium['track-count'] ?? 0), 0);
}

/** The distinct media formats of one edition, joined for display (`CD + DVD`). */
function formatsOf(release: { media?: readonly { format?: string | null }[] }): string {
  const formats = (release.media ?? [])
    .map((medium) => medium.format)
    .filter((format): format is string => typeof format === 'string' && format !== '');
  return [...new Set(formats)].join(' + ');
}

/**
 * A release group's editions, grouped by the choice that actually changes the download — which
 * tracklist — with the most-published tracklist first so the canonical album leads. The default is
 * not decided here: it is asked of {@link releaseGroupEditionIds}, the pipeline's own picker, so the
 * preview and the behavior it previews cannot drift apart. A group whose editions admit no
 * automatic pick says so rather than nominating one.
 */
export function toEditionListing(json: MbReleaseGroupBrowse): CatalogEditionListing {
  const releases = json.releases ?? [];
  const editions: CatalogEdition[] = [];
  const pickable: ReleaseGroupEdition[] = [];

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

  const byTrackCount = new Map<number, CatalogEdition[]>();
  for (const edition of editions) {
    const group = byTrackCount.get(edition.trackCount);
    if (group === undefined) byTrackCount.set(edition.trackCount, [edition]);
    else group.push(edition);
  }

  const groups: readonly CatalogEditionGroup[] = [...byTrackCount]
    .map(([trackCount, grouped]) => ({ trackCount, editions: grouped }))
    // Most-published tracklist first (the canonical one); ties by track count keep the listing
    // stable rather than depending on which edition the catalog happened to return first.
    .toSorted(
      (left, right) =>
        right.editions.length - left.editions.length || left.trackCount - right.trackCount,
    );

  const [pick] = releaseGroupEditionIds(pickable);
  return {
    groups,
    bestMatch: pick === undefined ? { kind: 'selectionRequired' } : { kind: 'pick', mbid: pick as Mbid },
  };
}

/**
 * One edition's running order. Positions come from the catalog where it states them and otherwise
 * from the reading order itself, so a sparse medium still numbers 1, 2, 3 the way a person expects.
 */
export function toTracks(release: MbRelease): readonly CatalogTrack[] {
  const tracks: CatalogTrack[] = [];
  const media = release.media ?? [];
  for (const medium of media) {
    const mediumTracks = medium.tracks ?? [];
    for (const track of mediumTracks) {
      const title = nameOf(track.title) ?? nameOf(track.recording?.title) ?? '';
      const length = track.length ?? track.recording?.length ?? undefined;
      tracks.push({
        position: track.position ?? tracks.length + 1,
        title,
        durationMs: length ?? undefined,
      });
    }
  }
  return tracks;
}

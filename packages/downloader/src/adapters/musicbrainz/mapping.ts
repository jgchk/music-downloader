import { branded } from '../../domain/shared/brand.js';
import type { Mbid } from '../../domain/shared/mbid.js';
import { createTarget } from '../../domain/target/target.js';
import type { Target } from '../../domain/target/target.js';
import type { EditionCandidate } from '../../domain/acquisition/events.js';
import type {
  MbBrowseRelease,
  MbRecording,
  MbRelease,
  MbScoredEntry,
  MbScoredRelease,
} from './schemas.js';

/**
 * Pure mapping from MusicBrainz JSON to the normalized, source-agnostic {@link Target} (D11,
 * anti-corruption layer). Any release/recording that can't yield a valid target — no tracks,
 * missing durations, no artist — collapses to `undefined`, which the adapter reports as the
 * business outcome *unresolved* rather than an infrastructure fault. MusicBrainz `length` fields
 * are already in milliseconds. The payload shapes are the contract-schema inferred types (D1); the
 * adapter validates against those before mapping, so these functions receive already-typed data.
 */

type MbArtistCredit = NonNullable<MbRelease['artist-credit']>[number];

const HIGH_CONFIDENCE = 90; // MusicBrainz search scores run 0–100
const AMBIGUITY_MARGIN = 10; // a top hit within this of the runner-up is not a confident pick

function artistCreditName(credits: readonly MbArtistCredit[] | undefined): string {
  return (credits ?? [])
    .map((credit) => `${credit.name ?? ''}${credit.joinphrase ?? ''}`)
    .join('')
    .trim();
}

function parseYear(date: string | null | undefined): number | undefined {
  const year = Number(date?.slice(0, 4));
  return Number.isSafeInteger(year) && year > 0 ? year : undefined;
}

/**
 * Brand a MusicBrainz id as an {@link Mbid} at this ACL edge. MusicBrainz is the *authoritative
 * issuer* of mbids, so its ids are trusted and branded directly — unlike a user-supplied id, which
 * the facade validates with `parseMbid` before it ever reaches the domain.
 */
function optionalMbid(id: string | undefined): Mbid | undefined {
  return id === undefined ? undefined : branded<Mbid>(id);
}

export function releaseToTarget(release: MbRelease): Target | undefined {
  const tracks = (release.media ?? []).flatMap((medium) =>
    (medium.tracks ?? []).map((track, index) => ({
      position: track.position ?? index + 1,
      title: track.title ?? track.recording?.title ?? '',
      durationMs: track.length ?? track.recording?.length ?? 0,
    })),
  );
  const result = createTarget({
    type: 'album',
    artist: artistCreditName(release['artist-credit']),
    title: release.title ?? '',
    tracks,
    year: parseYear(release.date),
    mbid: optionalMbid(release.id),
  });
  return result.isOk() ? result.value : undefined;
}

export function recordingToTarget(recording: MbRecording): Target | undefined {
  const result = createTarget({
    type: 'track',
    artist: artistCreditName(recording['artist-credit']),
    title: recording.title ?? '',
    tracks: [{ position: 1, title: recording.title ?? '', durationMs: recording.length ?? 0 }],
    mbid: optionalMbid(recording.id),
  });
  return result.isOk() ? result.value : undefined;
}

/**
 * The confident best match's id, or `undefined` when the results are empty, weak, or ambiguous.
 * This flat guard remains the recording-descriptor path: recordings have no release-group analogue,
 * so identity ambiguity is judged directly over the scored hits (see {@link releaseCandidateIds}
 * for the album path, which judges ambiguity across release groups instead).
 */
export function bestMatchId(entries: readonly MbScoredEntry[] | undefined): string | undefined {
  const scored = (entries ?? []).map((entry) => ({ id: entry.id, score: entry.score ?? 0 }));
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (best === undefined || best.score < HIGH_CONFIDENCE) return undefined;
  const second = scored[1];
  if (second !== undefined && best.score - second.score < AMBIGUITY_MARGIN) return undefined;
  return best.id;
}

/**
 * Normalize a title for exact-after-normalization comparison: canonical-compose, casefold, and
 * collapse every run of non-alphanumeric characters (punctuation, parentheses, brackets, whitespace)
 * to a single space, trimmed. So `"Midnights (3am Edition)"`, `"midnights  3AM edition"`, and
 * `"MIDNIGHTS (3am Edition)"` all normalize identically, while `"Midnights"` does not equal
 * `"Midnights (3am Edition)"`. Equality after this transform is the *only* edition-match relation —
 * there is deliberately no fuzzy or partial matching, because a wrong edition becomes the download
 * validation contract.
 */
export function normalizeTitle(title: string): string {
  return title
    .normalize('NFC')
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

interface GroupedRelease {
  readonly id: string;
  readonly score: number;
  readonly title: string;
  readonly status: string | undefined;
  readonly date: string | undefined;
  /**
   * The identity title of the group this release belongs to: the release-group title, or — for the
   * singleton fallback of a hit without a release-group id — the release's own title. Compared
   * against the request title (via {@link normalizeTitle}) by the exact-title preference in
   * {@link releaseCandidateIds}.
   */
  readonly groupTitle: string;
}

// Order MusicBrainz dates chronologically by (year, month, day) components rather than lexically:
// a lexical compare ranks a year-only `2012` *before* a same-year `2012-10-22`, letting an imprecise
// date displace a precisely-dated edition. Missing month/day map to a sentinel (99) that sorts after
// any real component, so within a year a fully-specified date precedes a year-only one; an undated or
// non-year-leading value maps to +Infinity and sorts after every dated release.
const DATE_COMPONENT_SENTINEL = 99;
function dateKey(date: string | null | undefined): number {
  const match = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/.exec(date ?? '');
  if (match === null) return Infinity;
  const year = Number(match[1]);
  const month = match[2] === undefined ? DATE_COMPONENT_SENTINEL : Number(match[2]);
  const day = match[3] === undefined ? DATE_COMPONENT_SENTINEL : Number(match[3]);
  return year * 10_000 + month * 100 + day;
}

/** Chronological comparison of two MusicBrainz dates via {@link dateKey}; equal keys rank equal. */
function compareDates(a: string | null | undefined, b: string | null | undefined): number {
  const aKey = dateKey(a);
  const bKey = dateKey(b);
  return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
}

/**
 * Order the releases within a resolved album (release group): those whose title matches the
 * requested title after normalization come first (edition intent expressed in the request text),
 * then the canonical rule — `Official` status before any other, then earliest release date.
 * Same-rank ties keep the incoming (search-relevance) order via the stable sort.
 */
function compareReleases(wantedTitle: string) {
  return (a: GroupedRelease, b: GroupedRelease): number => {
    const titleRank =
      Number(normalizeTitle(a.title) !== wantedTitle) -
      Number(normalizeTitle(b.title) !== wantedTitle);
    if (titleRank !== 0) return titleRank;
    const statusRank = Number(a.status !== 'Official') - Number(b.status !== 'Official');
    if (statusRank !== 0) return statusRank;
    return compareDates(a.date, b.date);
  };
}

/**
 * The ordered release ids to try for an album descriptor, best first — empty when the results are
 * empty, weak, or ambiguous. Hits are grouped by release group (the album identity), and identity
 * is resolved across groups in two steps. First, the exact-title preference: when exactly one
 * high-confidence group (score ≥ {@link HIGH_CONFIDENCE}; a group's score is its top hit's) has an
 * identity title equal to the request title under {@link normalizeTitle}, the request text itself
 * disambiguates and that group wins regardless of how closely derivative-named siblings score
 * (e.g. "Discovery" over a within-margin "Discovery Remixed" — and symmetrically, requesting
 * "Discovery Remixed" wins the remix group). Otherwise — no titled group (typos, partial titles)
 * or several (distinct albums genuinely sharing a title) — the confidence/ambiguity guard decides
 * over the full ranking: the best group must score at least {@link HIGH_CONFIDENCE} and beat the
 * runner-up group by at least {@link AMBIGUITY_MARGIN}, so ties fail safe as before. Many
 * equally-scored editions of one album are therefore a single unambiguous identity, not an
 * ambiguous result. Within the winning group, releases are ordered by {@link compareReleases}; the
 * caller fetches them in order and takes the first that yields a valid target, so a release with
 * unusable metadata falls through to the next.
 */
export function releaseCandidateIds(
  releases: readonly MbScoredRelease[] | undefined,
  requestTitle: string,
): readonly string[] {
  const groups = new Map<string, GroupedRelease[]>();
  const releaseList = releases ?? [];
  for (const release of releaseList) {
    if (release.id === undefined) continue;
    // A hit without a release-group id cannot be grouped by identity, so it forms its own singleton
    // group keyed by its release id — conservative, since it can only widen apparent ambiguity.
    const group = release['release-group'];
    const key = group?.id ?? `release:${release.id}`;
    const title = release.title ?? '';
    const member: GroupedRelease = {
      id: release.id,
      score: release.score ?? 0,
      title,
      status: release.status ?? undefined,
      date: release.date ?? undefined,
      groupTitle: group?.id === undefined ? title : (group.title ?? ''),
    };
    const existing = groups.get(key);
    if (existing === undefined) groups.set(key, [member]);
    else existing.push(member);
  }

  const ranked = groups
    .values()
    .map((members) => ({ members, score: Math.max(...members.map((m) => m.score)) }))
    .toArray()
    .toSorted((a, b) => b.score - a.score);

  const wanted = normalizeTitle(requestTitle);
  const titled = ranked.filter(
    (group) =>
      group.score >= HIGH_CONFIDENCE &&
      group.members.some((m) => normalizeTitle(m.groupTitle) === wanted),
  );

  let winner = titled.length === 1 ? titled[0] : undefined;
  if (winner === undefined) {
    const best = ranked[0];
    if (best === undefined || best.score < HIGH_CONFIDENCE) return [];
    const second = ranked[1];
    if (second !== undefined && best.score - second.score < AMBIGUITY_MARGIN) return [];
    winner = best;
  }

  return [...winner.members].toSorted(compareReleases(wanted)).map((m) => m.id);
}

/** One edition (release) of a known release group, reduced to the fields the picker needs. */
export interface ReleaseGroupEdition {
  readonly id: string;
  readonly status: string | undefined;
  readonly date: string | undefined;
  readonly trackCount: number;
}

/**
 * The most common track count among the editions, breaking a tie toward the *lower* count (the more
 * conservative, standard-like edition). Map iteration is insertion order, so the tie rule is applied
 * explicitly rather than relying on it. Assumes a non-empty input.
 */
function modalTrackCount(counts: readonly number[]): number {
  const frequency = new Map<number, number>();
  for (const count of counts) {
    frequency.set(count, (frequency.get(count) ?? 0) + 1);
  }
  let modal = 0;
  let modalFrequency = 0;
  for (const [count, freq] of frequency) {
    if (!(freq > modalFrequency || (freq === modalFrequency && count < modal))) {
      continue;
    }

    modal = count;
    modalFrequency = freq;
  }
  return modal;
}

/**
 * The ordered release ids to try for a release-group request (identity is given, so there is no
 * search, grouping, or cross-group ambiguity guard — and no request-title tier, since a bare group
 * id expresses no edition intent). Selection is confined to *official* editions: restrict to those
 * whose track count equals the modal count of the official editions, then order by earliest date
 * (chronological, precise before year-only within a year) with stable input order as the final
 * tiebreak. A group with no official edition (or no editions) yields no candidates — the adapter
 * then offers the group's editions for manual selection ({@link releaseGroupEditionCandidates}), or
 * reports *unresolved* when there are none. The caller fetches the ids in order and takes the first
 * that yields a valid target, so an edition with unusable metadata falls through to the next.
 */
export function releaseGroupEditionIds(
  editions: readonly ReleaseGroupEdition[],
): readonly string[] {
  const official = editions.filter((edition) => edition.status === 'Official');
  if (official.length === 0) return [];
  const modal = modalTrackCount(official.map((edition) => edition.trackCount));
  return official
    .filter((edition) => edition.trackCount === modal)
    .toSorted((a, b) => compareDates(a.date, b.date))
    .map((edition) => edition.id);
}

/**
 * Reduce a release-group browse (identity-typed editions) to the ordered release ids to try, via
 * {@link releaseGroupEditionIds}. An edition's total track count is the sum of its media's
 * `track-count`s (an unknown count contributes 0); editions without an id are dropped, since there
 * is nothing to fetch. Empty, all-non-official, or missing input yields no candidates — the adapter
 * then offers the editions for manual selection ({@link releaseGroupEditionCandidates}) or reports
 * *unresolved* when there are none.
 */
export function releaseGroupCandidateIds(
  releases: readonly MbBrowseRelease[] | undefined,
): readonly string[] {
  const editions: ReleaseGroupEdition[] = [];
  const releaseList = releases ?? [];
  for (const release of releaseList) {
    if (release.id === undefined) continue;
    editions.push({
      id: release.id,
      status: release.status ?? undefined,
      date: release.date ?? undefined,
      trackCount: totalTrackCount(release),
    });
  }
  return releaseGroupEditionIds(editions);
}

/** An edition's total track count: the sum of its media's `track-count`s (unknown contributes 0). */
function totalTrackCount(release: MbBrowseRelease): number {
  return (release.media ?? []).reduce((sum, medium) => sum + (medium['track-count'] ?? 0), 0);
}

/**
 * The candidate editions to offer for manual selection when a group has editions but no official
 * one (the `needsSelection` outcome). Every edition with an id is presented — none is silently
 * dropped, since the whole point is a human judging editions the picker won't. Ordered by the
 * picker's preference order so the most standard-looking edition leads: modal track count (over
 * all editions, ranking rather than filtering) first, then earliest date, stable input order as
 * the final tiebreak. Presentation fields pass through sparsely; an edition's distinct media
 * formats join into one display string (e.g. `CD + DVD`).
 */
export function releaseGroupEditionCandidates(
  releases: readonly MbBrowseRelease[] | undefined,
): readonly EditionCandidate[] {
  // The numeric count (0 = unknown) rides alongside each candidate purely for the picker's modal
  // ranking; it never reaches the event, where an unknown count is absent (never the sentinel 0).
  const editions: { readonly candidate: EditionCandidate; readonly count: number }[] = [];
  const releaseList = releases ?? [];
  for (const release of releaseList) {
    const releaseMbid = optionalMbid(release.id);
    if (releaseMbid === undefined) continue;
    const formats = [
      ...new Set(
        (release.media ?? [])
          .map((medium) => medium.format)
          .filter((format): format is string => typeof format === 'string'),
      ),
    ];
    const count = totalTrackCount(release);
    editions.push({
      count,
      candidate: {
        releaseMbid,
        title: release.title ?? undefined,
        date: release.date ?? undefined,
        country: release.country ?? undefined,
        format: formats.length > 0 ? formats.join(' + ') : undefined,
        ...(count > 0 && { trackCount: count }),
      },
    });
  }
  if (editions.length === 0) return [];
  const modal = modalTrackCount(editions.map((edition) => edition.count));
  return editions
    .toSorted((a, b) => {
      const modalRank = Number(a.count !== modal) - Number(b.count !== modal);
      if (modalRank !== 0) return modalRank;
      return compareDates(a.candidate.date, b.candidate.date);
    })
    .map((edition) => edition.candidate);
}

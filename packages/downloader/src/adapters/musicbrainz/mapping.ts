import { createTarget } from '../../domain/target/target.js';
import type { Target } from '../../domain/target/target.js';
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

function parseYear(date: string | undefined): number | undefined {
  const year = Number(date?.slice(0, 4));
  return Number.isInteger(year) && year > 0 ? year : undefined;
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
    mbid: release.id,
  });
  return result.isOk() ? result.value : undefined;
}

export function recordingToTarget(recording: MbRecording): Target | undefined {
  const result = createTarget({
    type: 'track',
    artist: artistCreditName(recording['artist-credit']),
    title: recording.title ?? '',
    tracks: [{ position: 1, title: recording.title ?? '', durationMs: recording.length ?? 0 }],
    mbid: recording.id,
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
  const second = scored[1];
  if (best === undefined || best.score < HIGH_CONFIDENCE) return undefined;
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
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
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
function dateKey(date: string | undefined): number {
  const match = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/.exec(date ?? '');
  if (match === null) return Number.POSITIVE_INFINITY;
  const year = Number(match[1]);
  const month = match[2] !== undefined ? Number(match[2]) : DATE_COMPONENT_SENTINEL;
  const day = match[3] !== undefined ? Number(match[3]) : DATE_COMPONENT_SENTINEL;
  return year * 10000 + month * 100 + day;
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
    const aDate = dateKey(a.date);
    const bDate = dateKey(b.date);
    return aDate < bDate ? -1 : aDate > bDate ? 1 : 0;
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
  for (const release of releases ?? []) {
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
      status: release.status,
      date: release.date,
      groupTitle: group?.id === undefined ? title : (group.title ?? ''),
    };
    const existing = groups.get(key);
    if (existing === undefined) groups.set(key, [member]);
    else existing.push(member);
  }

  const ranked = [...groups.values()]
    .map((members) => ({ members, score: Math.max(...members.map((m) => m.score)) }))
    .sort((a, b) => b.score - a.score);

  const wanted = normalizeTitle(requestTitle);
  const titled = ranked.filter(
    (group) =>
      group.score >= HIGH_CONFIDENCE &&
      group.members.some((m) => normalizeTitle(m.groupTitle) === wanted),
  );

  let winner = titled.length === 1 ? titled[0] : undefined;
  if (winner === undefined) {
    const best = ranked[0];
    const second = ranked[1];
    if (best === undefined || best.score < HIGH_CONFIDENCE) return [];
    if (second !== undefined && best.score - second.score < AMBIGUITY_MARGIN) return [];
    winner = best;
  }

  return [...winner.members].sort(compareReleases(wanted)).map((m) => m.id);
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
function modalTrackCount(editions: readonly ReleaseGroupEdition[]): number {
  const frequency = new Map<number, number>();
  for (const edition of editions) {
    frequency.set(edition.trackCount, (frequency.get(edition.trackCount) ?? 0) + 1);
  }
  let modal = 0;
  let modalFrequency = 0;
  for (const [count, freq] of frequency) {
    if (freq > modalFrequency || (freq === modalFrequency && count < modal)) {
      modal = count;
      modalFrequency = freq;
    }
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
 * reports that as *unresolved*. The caller fetches the ids in order and takes the first that yields a
 * valid target, so an edition with unusable metadata falls through to the next.
 */
export function releaseGroupEditionIds(
  editions: readonly ReleaseGroupEdition[],
): readonly string[] {
  const official = editions.filter((edition) => edition.status === 'Official');
  if (official.length === 0) return [];
  const modal = modalTrackCount(official);
  return official
    .filter((edition) => edition.trackCount === modal)
    .sort((a, b) => {
      const aDate = dateKey(a.date);
      const bDate = dateKey(b.date);
      return aDate < bDate ? -1 : aDate > bDate ? 1 : 0;
    })
    .map((edition) => edition.id);
}

/**
 * Reduce a release-group browse (identity-typed editions) to the ordered release ids to try, via
 * {@link releaseGroupEditionIds}. An edition's total track count is the sum of its media's
 * `track-count`s (an unknown count contributes 0); editions without an id are dropped, since there
 * is nothing to fetch. Empty, all-non-official, or missing input yields no candidates → *unresolved*.
 */
export function releaseGroupCandidateIds(
  releases: readonly MbBrowseRelease[] | undefined,
): readonly string[] {
  const editions: ReleaseGroupEdition[] = [];
  for (const release of releases ?? []) {
    if (release.id === undefined) continue;
    const trackCount = (release.media ?? []).reduce(
      (sum, medium) => sum + (medium['track-count'] ?? 0),
      0,
    );
    editions.push({ id: release.id, status: release.status, date: release.date, trackCount });
  }
  return releaseGroupEditionIds(editions);
}

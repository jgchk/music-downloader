import { createTarget } from '../../domain/target/target.js';
import type { Target } from '../../domain/target/target.js';
import type { MbRecording, MbRelease, MbScoredEntry, MbScoredRelease } from './schemas.js';

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

// Real MusicBrainz dates are year-leading (`2013`, `2016-11-04`), so they order chronologically
// under a plain lexicographic compare; an undated or non-year-leading value maps to a sentinel that
// sorts after them all, since ':' (0x3A) follows '9' (0x39).
const UNDATED = ':';
function dateKey(date: string | undefined): string {
  return date !== undefined && /^\d{4}/.test(date) ? date : UNDATED;
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

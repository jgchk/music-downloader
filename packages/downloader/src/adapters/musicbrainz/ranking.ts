import type {
  CatalogArtist,
  CatalogEntityKind,
  CatalogRecording,
  CatalogReleaseGroup,
} from '../../application/ports/catalog-search-port.js';

/**
 * Search relevance, as pure functions over already-fetched hits.
 *
 * MusicBrainz scores a hit by how much of the query one FIELD explains, so a derivative work whose
 * *title* happens to contain "Paul Simon's Graceland" outscores Graceland itself, which spends
 * "paul simon" on its artist credit. Ranking here re-reads each hit as a whole: query tokens the
 * artist credit accounts for count as matches, the tokens it does not account for are expected in
 * the title, and title words the searcher never typed are noise that costs. The provider's own
 * score is down-weighted to a nudge — at most 10 points against a 100-point coverage term — not a
 * tie-break; for an artist the query neither names nor contains, it remains the only signal.
 *
 * These are ranking heuristics, not domain rules — they order a human's choices and never decide
 * anything. Popularity is deliberately absent: two same-titled obscure releases still order by text
 * alone.
 */

/** A hit carrying the provider's relevance score, which ranking consumes and callers then drop. */
export type Scored<T> = T & { readonly score: number };
export type ScoredReleaseGroup = Scored<CatalogReleaseGroup>;
export type ScoredArtist = Scored<CatalogArtist>;
export type ScoredRecording = Scored<CatalogRecording>;

const COVERAGE_WEIGHT = 100;
const ARTIST_WEIGHT = 40;
const TITLE_WEIGHT = 25;
const NOISE_PENALTY = 8;
const PROVIDER_WEIGHT = 0.1;
const SECONDARY_TYPE_PENALTY = 15;
const UNRELEASED_PENALTY = 10;
const EXACT_NAME_BONUS = 100;
const CONTAINED_NAME_BONUS = 55;
const CONTAINED_NAME_TOKEN_BONUS = 5;
/** How far a recording must beat the best album-shaped hit before tracks lead — albums-first bias. */
const TRACK_LEAD_MARGIN = 15;

const TYPE_BONUS: Record<string, number> = { Album: 10, EP: 3, Single: 0 };
/** What counts as "an album" when deciding whether tracks should lead — a single never does. */
const ALBUM_SHAPED = new Set(['Album', 'EP']);

/**
 * Fold a title or name to comparable tokens: decompose accents away (so `Björk` matches `bjork`),
 * casefold, and treat every run of non-alphanumerics as a separator (so `Paul Simon's Graceland:`
 * yields plain words). The same fold is applied to the query and to what it is compared against,
 * which is what makes the comparison symmetric.
 */
function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replaceAll(/[\u{300}-\u{36F}]/gu, '')
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function tokens(value: string): readonly string[] {
  const normalized = normalize(value);
  return normalized === '' ? [] : normalized.split(' ');
}

/**
 * How well a (title, artist credit) pair explains the query, in four parts: how much of the query
 * the pair accounts for at all, how much of the artist credit the searcher actually typed (a full
 * artist match is strong evidence), whether the tokens the artist did not account for turn up in
 * the title, and how many title words the searcher never asked for. A query of only separators
 * explains nothing and scores flat HERE; callers still apply their own type and availability
 * adjustments, so provider order survives untouched only for artists.
 */
function pairScore(
  query: string,
  title: string,
  artistCredit: string,
  providerScore: number,
): number {
  const queryTokens = tokens(query);
  if (queryTokens.length === 0) return 0;
  const titleTokens = tokens(title);
  const artistTokens = tokens(artistCredit);

  const covered = queryTokens.filter(
    (token) => titleTokens.includes(token) || artistTokens.includes(token),
  ).length;
  const artistMatched =
    artistTokens.length === 0
      ? 0
      : artistTokens.filter((token) => queryTokens.includes(token)).length / artistTokens.length;
  const leftover = queryTokens.filter((token) => !artistTokens.includes(token));
  const titleMatched =
    leftover.length === 0
      ? 1
      : leftover.filter((token) => titleTokens.includes(token)).length / leftover.length;
  const noise = titleTokens.filter((token) => !queryTokens.includes(token)).length;

  return (
    (COVERAGE_WEIGHT * covered) / queryTokens.length +
    ARTIST_WEIGHT * artistMatched +
    TITLE_WEIGHT * titleMatched -
    NOISE_PENALTY * noise +
    PROVIDER_WEIGHT * providerScore
  );
}

function releaseGroupScore(query: string, hit: ScoredReleaseGroup): number {
  const typeBonus = hit.primaryType === undefined ? 0 : (TYPE_BONUS[hit.primaryType] ?? 0);
  const derivative = hit.secondaryTypes.length > 0 ? SECONDARY_TYPE_PENALTY : 0;
  return pairScore(query, hit.title, hit.artistCredit, hit.score) + typeBonus - derivative;
}

function recordingScore(query: string, hit: ScoredRecording): number {
  const unreleased = hit.release === undefined ? UNRELEASED_PENALTY : 0;
  return pairScore(query, hit.title, hit.artistCredit, hit.score) - unreleased;
}

/**
 * An artist is judged on its NAME against the whole query, not token-by-token: an exact match is
 * the strongest signal there is, and a name the query merely contains ("paul simon" inside "paul
 * simon graceland") is next — the longer such a name, the more of the query it explains, which is
 * what keeps a band literally called Graceland below Paul Simon for that query.
 */
function artistScore(query: string, hit: ScoredArtist): number {
  const normalizedQuery = normalize(query);
  const normalizedName = normalize(hit.name);
  const provider = PROVIDER_WEIGHT * hit.score;
  if (normalizedName === '' || normalizedQuery === '') return provider;
  if (normalizedName === normalizedQuery) return EXACT_NAME_BONUS + provider;
  if (isNamedIn(normalizedQuery, normalizedName)) {
    return CONTAINED_NAME_BONUS + CONTAINED_NAME_TOKEN_BONUS * tokens(hit.name).length + provider;
  }
  return provider;
}

/**
 * Whether the query contains the name as WHOLE words, in order. A bare substring test would let an
 * artist called `Head` — or `Rain` — score as though the searcher had named them, simply because
 * "radiohead in rainbows" contains those letters.
 */
function isNamedIn(normalizedQuery: string, normalizedName: string): boolean {
  return ` ${normalizedQuery} `.includes(` ${normalizedName} `);
}

/** Highest score first; equal scores keep provider order (`toSorted` is stable). */
function byDescendingScore<T>(items: readonly T[], score: (item: T) => number): readonly T[] {
  return items.toSorted((left, right) => score(right) - score(left));
}

export function rankReleaseGroups(
  query: string,
  hits: readonly ScoredReleaseGroup[],
): readonly ScoredReleaseGroup[] {
  return byDescendingScore(hits, (hit) => releaseGroupScore(query, hit));
}

export function rankArtists(query: string, hits: readonly ScoredArtist[]): readonly ScoredArtist[] {
  return byDescendingScore(hits, (hit) => artistScore(query, hit));
}

export function rankRecordings(
  query: string,
  hits: readonly ScoredRecording[],
): readonly ScoredRecording[] {
  return byDescendingScore(hits, (hit) => recordingScore(query, hit));
}

/** The best score in a set, or negative infinity when the set is empty — "nothing to compare". */
function bestScore<T>(items: readonly T[], score: (item: T) => number): number {
  let best = -Infinity;
  for (const item of items) best = Math.max(best, score(item));
  return best;
}

/**
 * Which kind of thing the query is asking about. An exact artist name is unambiguous and leads
 * outright. Otherwise tracks lead only when the best recording clearly beats the best ALBUM-SHAPED
 * release group — singles are excluded from that comparison, because a single named after the
 * track it contains would otherwise pass as album evidence for what is plainly a track search.
 * Everything else leads with albums, which is what most requests are for.
 */
export function leadingKind(
  query: string,
  hits: {
    readonly releaseGroups: readonly ScoredReleaseGroup[];
    readonly artists: readonly ScoredArtist[];
    readonly recordings: readonly ScoredRecording[];
  },
): CatalogEntityKind {
  const normalizedQuery = normalize(query);
  const isNamedExactly =
    normalizedQuery !== '' &&
    hits.artists.some((candidate) => normalize(candidate.name) === normalizedQuery);
  if (isNamedExactly) return 'artist';

  const albumShaped = hits.releaseGroups.filter(
    (hit) => hit.primaryType === undefined || ALBUM_SHAPED.has(hit.primaryType),
  );
  const bestAlbum = bestScore(albumShaped, (hit) => releaseGroupScore(query, hit));
  const bestRecording = bestScore(hits.recordings, (hit) => recordingScore(query, hit));
  return bestRecording > bestAlbum + TRACK_LEAD_MARGIN ? 'recording' : 'release-group';
}

import { parseMbid } from '../../domain/shared/mbid.js';
import type { Mbid } from '../../domain/shared/mbid.js';
import { createTarget } from '../../domain/target/target.js';
import type { Target } from '../../domain/target/target.js';
import type { EditionCandidate } from '../../domain/download/events.js';
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

// Absent-collection defaults (`x ?? []`) and the mutation gate: Stryker's ArrayDeclaration mutator
// rewrites every `[]` default below as `['Stryker was here']`. At each of those sites the injected
// string is then walked by a pipeline that reads a property a string does not have (`tracks`, `id`,
// `status`, `format`, `track-count`, `score`), so it contributes exactly what an empty array
// contributes: nothing. Those mutants are equivalent, and each is suppressed at its own site naming
// the property that neutralizes it — one line at a time rather than file-wide, so a genuine array
// literal here stays measured.

type MbArtistCredit = NonNullable<MbRelease['artist-credit']>[number];

const HIGH_CONFIDENCE = 90; // MusicBrainz search scores run 0–100
const AMBIGUITY_MARGIN = 10; // a top hit within this of the runner-up is not a confident pick

/**
 * The credited artist, joined as MusicBrainz spells it. Deliberately NOT trimmed here: both call
 * sites hand the result straight to `createTarget`, and `domain/target/target.ts` trims `artist`
 * itself before validating it — so a trim at this edge was code no test could distinguish. Removed
 * for the same reason `sanitizeSegment` and `buildQuery` dropped theirs.
 */
function artistCreditName(credits: readonly MbArtistCredit[] | undefined): string {
  // Stryker disable next-line ArrayDeclaration: the injected default element has neither `name` nor
  // `joinphrase`, so it maps to '' and joins away (the absent-collection note above).
  return (credits ?? []).map((credit) => `${credit.name ?? ''}${credit.joinphrase ?? ''}`).join('');
}

function parseYear(date: string | null | undefined): number | undefined {
  const year = Number(date?.slice(0, 4));
  return Number.isSafeInteger(year) && year > 0 ? year : undefined;
}

/**
 * Parse a MusicBrainz id into an {@link Mbid} at this ACL edge. MusicBrainz issues mbids as UUIDs,
 * so the id runs through the same `parseMbid` UUID guard the facade applies to user-supplied ids —
 * a malformed value (a garbled payload) reads as absent rather than being branded through blindly,
 * so it drops a target's mbid or skips an unidentifiable edition instead of forging a bad brand.
 */
function optionalMbid(id: string | undefined): Mbid | undefined {
  if (id === undefined) return undefined;
  const parsed = parseMbid(id);
  return parsed.isOk() ? parsed.value : undefined;
}

export function releaseToTarget(release: MbRelease): Target | undefined {
  // Stryker disable next-line ArrayDeclaration: equivalent — an injected string has no `tracks`, so
  // the flatMap body yields nothing and the track list stays empty (absent-collection note above).
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
    // Stryker disable next-line StringLiteral: the track title's default is unobservable. It only
    // differs from '' when the recording has no title — and then the *target* title above is '' too,
    // which `createTarget` rejects as EmptyTitle before it ever looks at a track.
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
  // Stryker disable next-line ArrayDeclaration: equivalent — an injected string has no `score`, so
  // it scores 0, falls below the confidence floor, and yields `undefined` exactly as no entry does.
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
 * `"Midnights (3am Edition)"`. Equality after this transform is the edition-match relation for any
 * title that survives it; a title every character of which is stripped is compared as its literal
 * text instead — see {@link comparableTitle}, which owns that second relation. There is deliberately
 * no fuzzy or partial matching under either, because a wrong edition becomes the download validation
 * contract.
 */
export function normalizeTitle(title: string): string {
  return title
    .normalize('NFC')
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * A title reduced to the form titles are compared in, or `undefined` when there is no title to
 * compare at all — MusicBrainz sent none, or it is nothing but separators.
 *
 * The bug this exists to prevent: {@link normalizeTitle} collapses a title of pure punctuation to
 * `''`, and an absent title used to become `''` too, so the two compared **equal**. A request for
 * `÷` then satisfied the exact-title preference against `+` (both Ed Sheeran; `?` is XXXTentacion),
 * or against a release MusicBrainz sent no title for, and won on text that distinguishes nothing —
 * bypassing the ambiguity guard that would otherwise have refused to choose.
 *
 * The fix is NOT to disqualify punctuation titles: `÷` names exactly one album, and it is the
 * normalizer that cannot represent it, not the request that is meaningless. Disqualifying it would
 * trade a wrong answer for no answer, permanently, for every album titled that way. So a title that
 * normalizes away falls back to its literal text, which still tells `÷` from `+`. The two value
 * spaces cannot collide: a fallback value contains no letter or number (`\p{L}`/`\p{N}`) by
 * construction, and a normalized value always contains at least one. Verified exhaustively over
 * every code point rather than argued: no `\p{L}`/`\p{N}` character is erased by
 * NFC → casefold → strip.
 *
 * `undefined` is therefore left meaning exactly one thing — *there is no title here* — which is what
 * makes it safe for {@link isSameTitle} to treat as matching nothing.
 */
function comparableTitle(title: string | null | undefined): string | undefined {
  if (title === null || title === undefined) return undefined;
  const normalized = normalizeTitle(title);
  if (normalized !== '') return normalized;
  // No casefold here, deliberately. Nothing reaching this line contains a letter or number
  // (`\p{L}`/`\p{N}`) — if it did, `normalizeTitle` would have kept it and returned above, and that
  // holds across the casefold it applies first — so for every title this can
  // actually receive there is no case to fold. Not a universal: a few cased SYMBOLS exist (`Ⓐ`
  // lowercases to `ⓐ`) and those now compare case-sensitively. Accepted rather than papered over —
  // no album is titled that way, and casefolding here would be a line no honest test could pin.
  const literal = title.normalize('NFC').trim();
  return literal === '' ? undefined : literal;
}

/**
 * Whether a candidate title is the requested one.
 *
 * Two titles match when they are equal AND present. Absence matches nothing — not another absence,
 * and not anything else. Two releases we have no title for are not evidence of the same album; they
 * are two things we cannot tell apart, which is the ambiguity guard's business, not this
 * preference's.
 *
 * Guarding `wanted` alone is sufficient because `===` already forces the other side: the only pair
 * it would wrongly accept is absent-against-absent, and excluding `wanted` excludes exactly that.
 * Note what that leaves — `a === b && a !== undefined` — which is **symmetric**. The parameter names
 * read as roles, but no call site can observe an argument swap, so there is no ordering here to
 * audit. If a directional rule ever arrives (a prefix match, casefolding one side only), take an
 * object parameter so the sides are named where they are passed.
 */
function isSameTitle(candidate: string | undefined, wanted: string | undefined): boolean {
  return wanted !== undefined && candidate === wanted;
}

interface GroupedRelease {
  readonly id: string;
  readonly score: number;
  /**
   * This release's own title, as {@link comparableTitle} — used to order editions within a group,
   * and standing in as {@link GroupedRelease.groupTitle} for the singleton fallback below.
   */
  readonly title: string | undefined;
  readonly status: string | undefined;
  readonly date: string | undefined;
  /**
   * The identity title of the group this release belongs to: the release-group title, or — for the
   * singleton fallback of a hit without a release-group id — the release's own title. Compared
   * against the request title (both via {@link comparableTitle}) by the exact-title preference in
   * {@link releaseCandidateIds}.
   */
  readonly groupTitle: string | undefined;
}

// Order MusicBrainz dates chronologically by (year, month, day) components rather than lexically:
// a lexical compare ranks a year-only `2012` *before* a same-year `2012-10-22`, letting an imprecise
// date displace a precisely-dated edition. Missing month/day map to a sentinel (99) that sorts after
// any real component, so within a year a fully-specified date precedes a year-only one; an undated or
// non-year-leading value maps to +Infinity and sorts after every dated release.
const DATE_COMPONENT_SENTINEL = 99;
function dateKey(date: string | null | undefined): number {
  // Stryker disable next-line StringLiteral: the `??` default is unobservable. The pattern is
  // anchored, so every string that does not start with four digits — '' and any sentinel alike —
  // fails to match and takes the `Infinity` branch below.
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
  if (aKey < bKey) return -1;
  // Stryker disable next-line ConditionalExpression,EqualityOperator: equivalent under the only
  // consumer this result has. It is read exclusively by `Array#toSorted`, and V8's sort asks a
  // comparator only whether it answered "negative" — it never distinguishes 0 from a positive
  // number. So no assertion on any sorted output can tell the `1` arm from the `0` arm, whichever
  // of them a mutant chooses. Both arms are kept because the comparator *contract* is
  // negative/zero/positive; the `< 0`-only shortcut is V8's implementation, not something to encode.
  return aKey > bKey ? 1 : 0;
}

/**
 * Order the releases within a resolved album (release group): those whose title matches the
 * requested title after normalization come first (edition intent expressed in the request text),
 * then the canonical rule — `Official` status before any other, then earliest release date.
 * Same-rank ties keep the incoming (search-relevance) order via the stable sort.
 */
function compareReleases(wantedTitle: string | undefined) {
  return (a: GroupedRelease, b: GroupedRelease): number => {
    const titleRank =
      Number(!isSameTitle(a.title, wantedTitle)) - Number(!isSameTitle(b.title, wantedTitle));
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
 * identity title equal to the request title under {@link comparableTitle}, the request text itself
 * disambiguates and that group wins regardless of how closely derivative-named siblings score
 * (e.g. "Discovery" over a within-margin "Discovery Remixed" — and symmetrically, requesting
 * "Discovery Remixed" wins the remix group). A title with no comparable text at all — absent
 * upstream, or nothing but separators — never satisfies that preference ({@link isSameTitle}), so it
 * cannot bypass the guard on text that identifies no album; a punctuation title like `÷` still does,
 * against an identically-spelled one. Otherwise — no titled group (typos, partial titles, untitled
 * hits)
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
  // Stryker disable next-line ArrayDeclaration: equivalent — an injected string has no `id`, so the
  // loop's first guard skips it and no group is formed (absent-collection note above).
  const releaseList = releases ?? [];
  for (const release of releaseList) {
    if (release.id === undefined) continue;
    // A hit without a release-group id cannot be grouped by identity, so it forms its own singleton
    // group keyed by its release id — conservative, since it can only widen apparent ambiguity.
    const group = release['release-group'];
    const key = group?.id ?? `release:${release.id}`;
    const title = comparableTitle(release.title);
    const member: GroupedRelease = {
      id: release.id,
      score: release.score ?? 0,
      title,
      status: release.status ?? undefined,
      date: release.date ?? undefined,
      groupTitle: group?.id === undefined ? title : comparableTitle(group.title),
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

  const wanted = comparableTitle(requestTitle);
  const titled = ranked.filter(
    (group) =>
      group.score >= HIGH_CONFIDENCE &&
      group.members.some((m) => isSameTitle(m.groupTitle, wanted)),
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

/**
 * One edition (release) of a known release group, reduced to the fields the picker needs. Generic
 * in its identifier so a caller holding parsed ids gets parsed ids back: the picker only ever
 * chooses among what it was handed, so re-asserting a brand on the way out would be a claim
 * nothing checked.
 */
export interface ReleaseGroupEdition<Id extends string = string> {
  readonly id: Id;
  readonly status: string | undefined;
  readonly date: string | undefined;
  /**
   * How many tracks, or nothing when the catalog states no count. NOT a sentinel `0`: zero is
   * lower than every real count, and the modal tie-break prefers the lower — so an edition the
   * catalog declined to describe would beat a properly described one and be downloaded.
   */
  readonly trackCount: number | undefined;
}

/**
 * The most common track count among the editions, breaking a tie toward the *lower* count (the more
 * conservative, standard-like edition). Map iteration is insertion order, so the tie rule is applied
 * explicitly rather than relying on it. Total by construction: an input with no stated count yields
 * `undefined`, and both callers then filter their own list against that — keeping the uncounted
 * editions only when there is nothing better, which is why neither guards the call.
 *
 * An unstated count does not stand for election. It cannot be "most common" — there is no count to
 * be common — and treating it as one would hand the group to the edition the catalog says least
 * about.
 */
function modalTrackCount(counts: readonly (number | undefined)[]): number | undefined {
  const frequency = new Map<number, number>();
  for (const count of counts) {
    if (count === undefined) continue;
    frequency.set(count, (frequency.get(count) ?? 0) + 1);
  }
  let modal: number | undefined;
  let modalFrequency = 0;
  for (const [count, freq] of frequency) {
    // Stryker recorded-survivor EqualityOperator `count <= (modal ?? 0)`: equivalent — this arm is
    // only ever reached when `freq === modalFrequency`, which requires `modalFrequency >= 1` and so
    // requires `modal` to have already been set to a count taken from this very map (on the first
    // iteration `modalFrequency` is 0, every real `freq` is >= 1, and the first arm short-circuits
    // before this one is evaluated). Map keys are distinct, so `count === modal` cannot hold here
    // and `<` and `<=` cannot disagree. Waived per mutant, not per line: a
    // `disable next-line EqualityOperator` would silence the four killable siblings this line
    // carries — `>=`/`<=` on the frequency test, `!==` on the tie test, and `count >= (modal ?? 0)`,
    // which inverts the documented lower-count tie-break. Silencing four real findings to hide one
    // equivalent mutant is the trade the waiver doctrine rejects.
    if (!(freq > modalFrequency || (freq === modalFrequency && count < (modal ?? 0)))) {
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
export function releaseGroupEditionIds<Id extends string>(
  editions: readonly ReleaseGroupEdition<Id>[],
): readonly Id[] {
  const official = editions.filter((edition) => edition.status === 'Official');
  // No early return for an empty `official`: `modalTrackCount` is total (0 for an empty input) and
  // the filter below then runs over the same empty list, so the function already answers []. The
  // guard that used to stand here was provably unable to change any answer, which is the signal to
  // delete it rather than waive it.
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
  // Stryker disable next-line ArrayDeclaration: equivalent — an injected seed element has no
  // `status`, so `releaseGroupEditionIds` filters it out as non-official before anything reads it.
  const editions: ReleaseGroupEdition[] = [];
  // Stryker disable next-line ArrayDeclaration: equivalent — an injected string has no `id`, so the
  // loop's first guard skips it and no edition is collected (absent-collection note above).
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

/**
 * An edition's total track count: the sum of its media's `track-count`s, or nothing at all when no
 * medium states one. Absent rather than 0 — see {@link ReleaseGroupEdition.trackCount}.
 */
function totalTrackCount(release: MbBrowseRelease): number | undefined {
  // Stryker disable next-line ArrayDeclaration: equivalent — the injected string has no
  // `track-count`, so it maps to `undefined` and the `typeof count === 'number'` filter drops it,
  // leaving the same empty `counts` an absent `media` leaves (the absent-collection note above).
  const counts = (release.media ?? [])
    .map((medium) => medium['track-count'])
    .filter((count): count is number => typeof count === 'number');
  return counts.length === 0 ? undefined : counts.reduce((sum, count) => sum + count, 0);
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
  // The count rides alongside each candidate purely for the picker's modal ranking; it never
  // reaches the event, where an unknown count is simply absent — as it is here.
  const editions: {
    readonly candidate: EditionCandidate;
    readonly count: number | undefined;
  }[] = [];
  // Stryker disable next-line ArrayDeclaration: equivalent — an injected string has no `id`, so
  // `optionalMbid` reads it as absent and the loop's guard skips it, presenting no candidate.
  const releaseList = releases ?? [];
  for (const release of releaseList) {
    const releaseMbid = optionalMbid(release.id);
    if (releaseMbid === undefined) continue;
    const formats = [
      ...new Set(
        // Stryker disable next-line ArrayDeclaration: equivalent — an injected string has no
        // `format`, so the type guard below drops it and the format list stays empty.
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
        ...(count !== undefined && { trackCount: count }),
      },
    });
  }
  // As in `releaseGroupEditionIds`: no empty-list guard, because `modalTrackCount` is total and the
  // sort/map below present [] from an empty list anyway. A guard no input can make matter is code
  // to delete, not code to waive.
  const modal = modalTrackCount(editions.map((edition) => edition.count));
  return editions
    .toSorted((a, b) => {
      const modalRank = Number(a.count !== modal) - Number(b.count !== modal);
      if (modalRank !== 0) return modalRank;
      return compareDates(a.candidate.date, b.candidate.date);
    })
    .map((edition) => edition.candidate);
}

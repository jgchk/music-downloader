import type { ResultAsync } from 'neverthrow';
import type { Mbid } from '../../domain/shared/mbid.js';
import type { OperationScope } from '../correlation/context.js';
import type { InfraError } from './errors.js';

/**
 * The catalog-search port: the read side a person uses to FORMULATE a request, distinct from
 * {@link MetadataPort}, which resolves an already-formulated one. Search browses the catalog and
 * answers in the catalog's own language (release groups, artists, recordings, editions); metadata
 * resolution answers in the domain's (a {@link Target} to acquire). Keeping them apart is what lets
 * search rank, group, and preview for a human without any of that leaking into resolution, where a
 * wrong pick becomes the download contract.
 *
 * Like every outbound port here, methods return `ResultAsync<_, InfraError>` and take the
 * dispatching {@link OperationScope} last. Expected *outcomes* — no matches, an identifier that
 * names nothing, a release group whose editions admit no automatic pick — are `Ok` values, never
 * `Err`; only infrastructure faults travel the error channel.
 */

/** One album-level identity: the thing a person means by "an album", across all its editions. */
export interface CatalogReleaseGroup {
  readonly mbid: Mbid;
  readonly title: string;
  /** The credit line as the catalog renders it (joined, so "A & B" survives intact). */
  readonly artistCredit: string;
  readonly year: number | undefined;
  /** `Album` | `EP` | `Single` | … — absent when the catalog does not say. */
  readonly primaryType: string | undefined;
  /** `Live`, `Remix`, `Compilation`, … — empty for a standard release. */
  readonly secondaryTypes: readonly string[];
}

export interface CatalogArtist {
  readonly mbid: Mbid;
  readonly name: string;
  /** The catalog's own tie-breaker between same-named artists ("UK house project", "Group"). */
  readonly disambiguation: string | undefined;
}

export interface CatalogRecording {
  readonly mbid: Mbid;
  readonly title: string;
  readonly artistCredit: string;
  /** A release the recording appears on, when the catalog names one — the artwork/context source. */
  readonly release: { readonly mbid: Mbid; readonly title: string } | undefined;
}

/** Which block of results answers the query best — see {@link CatalogSearchPort.search}. */
export type CatalogEntityKind = 'release-group' | 'artist' | 'recording';

export interface CatalogSearchResults {
  readonly releaseGroups: readonly CatalogReleaseGroup[];
  readonly artists: readonly CatalogArtist[];
  readonly recordings: readonly CatalogRecording[];
  /** The kind the query is asking about, so a presenter can lead with it. */
  readonly leading: CatalogEntityKind;
}

/** A single entity named by an identifier: the paste-an-id path's answer. */
export type CatalogEntity =
  | { readonly kind: 'release-group'; readonly releaseGroup: CatalogReleaseGroup }
  | { readonly kind: 'artist'; readonly artist: CatalogArtist }
  | { readonly kind: 'recording'; readonly recording: CatalogRecording };

/** An identifier that names nothing in the catalog is an outcome, not a fault. */
export type CatalogLookup =
  { readonly kind: 'found'; readonly entity: CatalogEntity } | { readonly kind: 'notFound' };

/** One concrete edition (a release) of a release group. */
export interface CatalogEdition {
  readonly mbid: Mbid;
  readonly title: string;
  readonly disambiguation: string | undefined;
  readonly date: string | undefined;
  readonly country: string | undefined;
  /** The edition's distinct media formats (e.g. `['CD', 'DVD']`); empty when the catalog is silent. */
  readonly formats: readonly string[];
  readonly status: string | undefined;
  /**
   * How many tracks this pressing has, or absent when the catalog does not say. Absent rather than
   * `0`: the two are different facts, and collapsing them groups every uncounted pressing together
   * and prints "0 tracks" under a record that plainly has some.
   */
  readonly trackCount: number | undefined;
}

/**
 * Editions sharing a track count. Grouping by tracklist rather than by format is deliberate: the
 * choice that changes what gets downloaded is WHICH TRACKLIST, while format is a filter over it.
 */
export interface CatalogEditionGroup {
  /**
   * The edition this group is read from — its tracklist is the group's tracklist. Modeled
   * explicitly rather than left as "the first one", so no reader has to guard against a group
   * with no editions, which grouping cannot produce. Its `trackCount` is the group's — carried
   * once, on the edition it was read from, so the two can never disagree.
   */
  readonly representative: CatalogEdition;
  readonly editions: readonly CatalogEdition[];
}

/**
 * The FIRST edition the acquisition pipeline's own picker would try for this release group —
 * produced by that same picker, so the policy cannot drift from the behavior it previews. (The
 * pipeline walks the picker's ordered ids and takes the first that yields a usable target, so it
 * may skip past this one.) A group with no official edition yields `selectionRequired`, mirroring
 * the pipeline's `needsSelection`.
 */
export type BestMatchEdition =
  { readonly kind: 'pick'; readonly mbid: Mbid } | { readonly kind: 'selectionRequired' };

export interface CatalogEditionListing {
  /** Groups ordered most-editions-first, so the canonical tracklist leads. */
  readonly groups: readonly CatalogEditionGroup[];
  readonly bestMatch: BestMatchEdition;
}

export interface CatalogTrack {
  readonly position: number;
  readonly title: string;
  readonly durationMs: number | undefined;
}

export interface CatalogSearchPort {
  /** Free-text search across release groups, artists, and recordings, ranked and intent-ordered. */
  search(query: string, scope: OperationScope): ResultAsync<CatalogSearchResults, InfraError>;
  /** Resolve one identifier to whichever entity kind it names. */
  lookup(mbid: Mbid, scope: OperationScope): ResultAsync<CatalogLookup, InfraError>;
  /** An artist's release groups: albums first, everything else after, newest first within each of those two groups. */
  discography(
    artist: Mbid,
    scope: OperationScope,
  ): ResultAsync<readonly CatalogReleaseGroup[], InfraError>;
  /** A release group's editions grouped by tracklist, with the pipeline's own default identified. */
  editions(
    releaseGroup: Mbid,
    scope: OperationScope,
  ): ResultAsync<CatalogEditionListing, InfraError>;
  /** One edition's ordered tracks — fetched on demand, never for every search hit. */
  tracklist(release: Mbid, scope: OperationScope): ResultAsync<readonly CatalogTrack[], InfraError>;
}

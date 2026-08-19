<script lang="ts">
  import { enhance } from '$app/forms';
  import {
    albumDetail,
    alternativeLabel,
    artUrl,
    countOf,
    emptyLead,
    initialsOf,
    unavailableNotice,
    orderedKinds,
    otherMatches,
    topResults,
    trackDetail,
    trimmedCount,
  } from '$lib/search/view.js';
  import CoverArt from './CoverArt.svelte';
  import type { DetailContext } from '$lib/search/detail.js';
  import type { EntityFilter, EntityKind } from '$lib/search/view.js';
  import type { CatalogSearchResultDto } from '@music/downloader';

  interface Properties {
    /** What the catalog matched, already ranked and intent-ordered by the server. */
    results: CatalogSearchResultDto;
    /** Which kind is being looked at; `all` shows every kind that matched. */
    filter: EntityFilter;
    /** What was searched for, so an empty answer can name it. */
    query: string;
    /** Open a result's detail view, handing it what this card already knows. */
    onOpen: (kind: EntityKind, mbid: string, context: DetailContext) => void;
    /** Look at a different kind — the way out of an empty filtered view. */
    onFilter: (filter: EntityFilter) => void;
  }

  let { results, filter, query, onOpen, onFilter }: Properties = $props();

  const kinds = $derived(orderedKinds(results, filter));
  /**
   * What each block lists — the top results in the mixed view, everything once a kind is what is
   * being looked at — and what its heading may honestly claim about the rest.
   */
  const shownGroups = $derived(topResults(results.releaseGroups, 'release-group', filter));
  const shownArtists = $derived(topResults(results.artists, 'artist', filter));
  const shownRecordings = $derived(topResults(results.recordings, 'recording', filter));
  const listedOf: Record<EntityKind, () => number> = {
    'release-group': () => shownGroups.length,
    artist: () => shownArtists.length,
    recording: () => shownRecordings.length,
  };
  const shownCount = $derived((kind: EntityKind) =>
    trimmedCount(countOf(results, kind), listedOf[kind]()),
  );
  const notice = $derived(unavailableNotice(results));
  /** How many requests are in flight, so a submitted form cannot be submitted again. */
  let requesting = $state(0);

  /**
   * Enhanced submission keeps the page — which also keeps the button live for the whole round
   * trip, so without this a second click sends a second download.
   */
  const oneAtATime = () => {
    requesting += 1;
    return async ({ update }: { update: (options: { reset: boolean }) => Promise<void> }) => {
      await update({ reset: false });
      requesting -= 1;
    };
  };
  const elsewhere = $derived(otherMatches(results, filter));

  const HEADINGS: Record<EntityKind, string> = {
    'release-group': 'Albums',
    artist: 'Artists',
    recording: 'Tracks',
  };
</script>

{#if notice !== undefined}
  <!-- Above the blocks, not inside one: a person who filtered to albums would never see a notice
       that lived in the artists section, and would be told to check a spelling that is fine. -->
  <p class="error" role="alert" data-testid="kind-unavailable">{notice}</p>
{/if}

{#if kinds.length === 0}
  <p class="empty-results" data-testid="no-matches">
    <span>{emptyLead(filter, query, elsewhere)}</span>
    {#each elsewhere as other (other.kind)}
      <span>{other.joiner}</span>
      <button type="button" class="linkish" onclick={() => onFilter(other.kind)}>
        <span>{alternativeLabel(other)}</span>
      </button>
    {/each}
    {#if elsewhere.length > 0}<span>did.</span>{/if}
  </p>
{/if}

{#each kinds as kind (kind)}
  {@const count = shownCount(kind)}
  <section class="results" data-kind={kind}>
    <h2>
      <span>{HEADINGS[kind]}</span>
      {#if count.isTrimmed}
        <!-- The rest are one interaction away, and the heading says so rather than implying the
             block is everything that matched. -->
        <button type="button" class="linkish count" onclick={() => onFilter(kind)}>
          {count.label}
        </button>
      {:else}
        <span class="count">{count.label}</span>
      {/if}
    </h2>

    {#if kind === 'release-group'}
      <ul class="art-grid">
        {#each shownGroups as group (group.mbid)}
          <li class="result">
            <button
              type="button"
              class="result-open"
              onclick={() =>
                onOpen('release-group', group.mbid, {
                  title: group.title,
                  artistCredit: group.artistCredit,
                  year: group.year,
                  primaryType: group.primaryType,
                })}
            >
              <CoverArt
                src={artUrl('release-group', group.mbid, 250)}
                initials={initialsOf(group.title)}
              />
              <span class="result-title">{group.title}</span>
              <span class="result-detail">{albumDetail(group)}</span>
            </button>
            <form
              method="POST"
              action="/acquisitions/new"
              class="request-form"
              use:enhance={oneAtATime}
            >
              <input type="hidden" name="kind" value="release-group" />
              <input type="hidden" name="mbid" value={group.mbid} />
              <button type="submit" class="btn primary request" disabled={requesting > 0}>
                {requesting > 0 ? 'Requesting…' : 'Request'}
              </button>
            </form>
          </li>
        {/each}
      </ul>
    {:else if kind === 'artist'}
      <ul class="artist-row">
        {#each shownArtists as artist (artist.mbid)}
          <li class="result">
            <button
              type="button"
              class="result-open"
              onclick={() => onOpen('artist', artist.mbid, { title: artist.name })}
            >
              <CoverArt initials={initialsOf(artist.name)} shape="artist" />
              <span class="result-title">{artist.name}</span>
              <span class="result-detail">{artist.disambiguation ?? 'Artist'}</span>
              <span class="result-action">Browse releases</span>
            </button>
          </li>
        {/each}
      </ul>
    {:else if kind === 'recording'}
      <ul class="track-rows">
        {#each shownRecordings as recording (recording.mbid)}
          <li class="result">
            <button
              type="button"
              class="result-open"
              onclick={() =>
                onOpen('recording', recording.mbid, {
                  title: recording.title,
                  artistCredit: recording.artistCredit,
                  release: recording.release,
                })}
            >
              <CoverArt
                src={recording.release === undefined
                  ? undefined
                  : artUrl('release', recording.release.mbid, 250)}
                initials={initialsOf(recording.title)}
                shape="thumb"
              />
              <span class="result-title">{recording.title}</span>
              <span class="result-detail">{trackDetail(recording)}</span>
            </button>
            <form
              method="POST"
              action="/acquisitions/new"
              class="request-form"
              use:enhance={oneAtATime}
            >
              <input type="hidden" name="kind" value="musicbrainz" />
              <input type="hidden" name="targetType" value="track" />
              <input type="hidden" name="mbid" value={recording.mbid} />
              <button type="submit" class="btn primary request" disabled={requesting > 0}>
                {requesting > 0 ? 'Requesting…' : 'Request'}
              </button>
            </form>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{/each}

<script lang="ts">
  import {
    albumDetail,
    alternativeLabel,
    artUrl,
    countOf,
    emptyLead,
    orderedKinds,
    otherMatches,
    trackDetail,
  } from '$lib/search/view.js';
  import type { EntityFilter, EntityKind } from '$lib/search/view.js';
  import type { CatalogSearchResultDto } from '@music/downloader';

  interface Properties {
    /** What the catalog matched, already ranked and intent-ordered by the server. */
    results: CatalogSearchResultDto;
    /** Which kind is being looked at; `all` shows every kind that matched. */
    filter: EntityFilter;
    /** What was searched for, so an empty answer can name it. */
    query: string;
    /** Open a result's detail surface. */
    onOpen: (kind: EntityKind, mbid: string, title: string) => void;
    /** Look at a different kind — the way out of an empty filtered view. */
    onFilter: (filter: EntityFilter) => void;
  }

  let { results, filter, query, onOpen, onFilter }: Properties = $props();

  const kinds = $derived(orderedKinds(results, filter));
  const elsewhere = $derived(otherMatches(results, filter));

  const HEADINGS: Record<EntityKind, string> = {
    'release-group': 'Albums',
    artist: 'Artists',
    recording: 'Tracks',
  };

  const initialsOf = (title: string): string =>
    title
      .split(/\s+/)
      .slice(0, 2)
      .map((word) => word.charAt(0).toUpperCase())
      .join('');
</script>

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
  <section class="results" data-kind={kind}>
    <h2><span>{HEADINGS[kind]}</span> <span class="count">{countOf(results, kind)}</span></h2>

    {#if kind === 'release-group'}
      <ul class="art-grid">
        {#each results.releaseGroups as group (group.mbid)}
          <li class="result">
            <button
              type="button"
              class="result-open"
              onclick={() => onOpen('release-group', group.mbid, group.title)}
            >
              <span class="art">
                <img
                  src={artUrl('release-group', group.mbid, 250)}
                  alt=""
                  loading="lazy"
                  width="250"
                  height="250"
                />
                <span class="art-placeholder" aria-hidden="true">{initialsOf(group.title)}</span>
              </span>
              <span class="result-title">{group.title}</span>
              <span class="result-detail">{albumDetail(group)}</span>
            </button>
            <form method="POST" action="/acquisitions/new" class="request-form">
              <input type="hidden" name="kind" value="release-group" />
              <input type="hidden" name="mbid" value={group.mbid} />
              <button type="submit" class="btn primary request">Request</button>
            </form>
          </li>
        {/each}
      </ul>
    {:else if kind === 'artist'}
      <ul class="artist-row">
        {#each results.artists as artist (artist.mbid)}
          <li class="result">
            <button
              type="button"
              class="result-open"
              onclick={() => onOpen('artist', artist.mbid, artist.name)}
            >
              <span class="art art-artist">
                <span class="art-placeholder" aria-hidden="true">{initialsOf(artist.name)}</span>
              </span>
              <span class="result-title">{artist.name}</span>
              <span class="result-detail">{artist.disambiguation ?? 'Artist'}</span>
              <span class="result-action">Browse releases</span>
            </button>
          </li>
        {/each}
      </ul>
    {:else}
      <ul class="track-rows">
        {#each results.recordings as recording (recording.mbid)}
          <li class="result">
            <button
              type="button"
              class="result-open"
              onclick={() => onOpen('recording', recording.mbid, recording.title)}
            >
              <span class="art art-thumb">
                {#if recording.release !== undefined}
                  <img
                    src={artUrl('release', recording.release.mbid, 250)}
                    alt=""
                    loading="lazy"
                    width="250"
                    height="250"
                  />
                {/if}
                <span class="art-placeholder" aria-hidden="true">{initialsOf(recording.title)}</span
                >
              </span>
              <span class="result-title">{recording.title}</span>
              <span class="result-detail">{trackDetail(recording)}</span>
            </button>
            <form method="POST" action="/acquisitions/new" class="request-form">
              <input type="hidden" name="kind" value="musicbrainz" />
              <input type="hidden" name="targetType" value="track" />
              <input type="hidden" name="mbid" value={recording.mbid} />
              <button type="submit" class="btn primary request">Request</button>
            </form>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{/each}

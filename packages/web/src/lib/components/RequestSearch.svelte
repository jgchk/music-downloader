<script lang="ts">
  import CatalogDetail from './CatalogDetail.svelte';
  import CatalogResults from './CatalogResults.svelte';
  import { httpCatalog } from '$lib/search/client.js';
  import { openDetail, readTracklist, runSearch } from '$lib/search/session.js';
  import { searchTyping, startTyping } from '$lib/search/typing.js';
  import type { CatalogClient } from '$lib/search/client.js';
  import type { DetailState, TracklistState } from '$lib/search/detail.js';
  import type { TypingDriver } from '$lib/search/typing.js';
  import type { EntityFilter } from '$lib/search/view.js';
  import type { CatalogSearchResultDto } from '@music/downloader';

  interface Properties {
    /** Action-failure message from a rejected submission (the native fallback's path). */
    error?: string;
    /** The catalog conversation — injected so the surface can be driven without a server. */
    catalog?: CatalogClient;
    /** When typing becomes a search — injected so tests need not wait out a debounce. */
    typing?: TypingDriver;
  }

  let { error, catalog = httpCatalog(), typing = searchTyping }: Properties = $props();

  let query = $state('');
  let filter = $state<EntityFilter>('all');
  let results = $state<CatalogSearchResultDto | undefined>();
  let failure = $state<string | undefined>();
  let searching = $state(false);
  let detail = $state<DetailState | undefined>();
  let tracklists = $state<Record<string, TracklistState>>({});

  /** The search in flight, abandoned as soon as a newer one starts. */
  let inFlight: AbortController | undefined;

  const FILTERS: readonly { readonly value: EntityFilter; readonly label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'release-group', label: 'Albums' },
    { value: 'artist', label: 'Artists' },
    { value: 'recording', label: 'Tracks' },
  ];

  function clear(): void {
    inFlight?.abort();
    inFlight = undefined;
    searching = false;
    results = undefined;
    failure = undefined;
  }

  function run(text: string): void {
    inFlight?.abort();
    const controller = new AbortController();
    inFlight = controller;
    failure = undefined;
    void runSearch(catalog, text, controller.signal, {
      onSearching: (value) => (searching = value),
      onResults: (value) => (results = value),
      onFailure: (message) => {
        failure = message;
        results = undefined;
      },
    });
  }

  function searchNow(): void {
    startTyping(query, true, typing, { clear, search: run });
  }

  // The whole timing decision lives in `startTyping`; this is its one-line wiring, which SSR
  // compiles out — the server renders the pre-search page and the browser takes it from there.
  $effect(() => startTyping(query, false, typing, { clear, search: run }));
</script>

<div class="request-search">
  {#if error}
    <p class="error" role="alert" data-testid="form-error">{error}</p>
  {/if}

  <div class="search-field">
    <label class="search-label" for="catalog-query">Search the catalog</label>
    <input
      id="catalog-query"
      type="search"
      autocomplete="off"
      placeholder="An artist, an album, a track — or paste a MusicBrainz ID"
      bind:value={query}
      onkeydown={(event) => {
        if (event.key !== 'Enter') {
          return;
        }

        event.preventDefault();
        searchNow();
      }}
      data-testid="catalog-query"
    />
    {#if searching}
      <span class="searching" role="status" data-testid="searching">Searching…</span>
    {/if}
  </div>

  <nav class="entity-filter" aria-label="Kind of result">
    {#each FILTERS as option (option.value)}
      <button
        type="button"
        aria-pressed={filter === option.value}
        onclick={() => (filter = option.value)}
      >
        {option.label}
      </button>
    {/each}
  </nav>

  {#if failure !== undefined}
    <p class="error" role="alert" data-testid="search-error">{failure}</p>
  {:else if results !== undefined}
    <CatalogResults
      {results}
      {filter}
      {query}
      onOpen={(kind, mbid, title) => {
        tracklists = {};
        void openDetail(catalog, kind, mbid, title, (opened) => (detail = opened));
      }}
      onFilter={(next) => (filter = next)}
    />
  {:else if !searching}
    <p class="search-hint" data-testid="search-hint">
      Search the catalog by artist, album, or track — results appear as you type, or press Enter to
      search right away. Have the exact ID? Paste a MusicBrainz ID into the same box.
    </p>
  {/if}

  <CatalogDetail
    {detail}
    {tracklists}
    onTracklist={(mbid) =>
      void readTracklist(catalog, mbid, tracklists, (next) => (tracklists = next))}
    onClose={() => (detail = undefined)}
  />

  <details class="native-request">
    <summary>Request by artist and title</summary>
    <form method="POST" data-testid="native-form">
      <label>
        Artist
        <input name="artist" data-testid="native-artist" />
      </label>
      <label>
        Title
        <input name="title" data-testid="native-title" />
      </label>
      <input type="hidden" name="kind" value="descriptor" />
      <input type="hidden" name="targetType" value="album" />
      <button type="submit" class="btn primary">Request download</button>
    </form>
  </details>
</div>

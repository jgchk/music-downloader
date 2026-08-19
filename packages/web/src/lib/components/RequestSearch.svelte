<script lang="ts">
  import CatalogDetail from './CatalogDetail.svelte';
  import CatalogResults from './CatalogResults.svelte';
  import RequestPolicies from './RequestPolicies.svelte';
  import { enhance } from '$app/forms';
  import { UNEXPECTED, httpCatalog } from '$lib/search/client.js';
  import { browseArtist, openDetail, readTracklist, runSearch } from '$lib/search/session.js';
  import type { SearchOutcome } from '$lib/search/session.js';
  import { searchTyping, startTyping } from '$lib/search/typing.js';
  import { asBrowsedResults } from '$lib/search/view.js';
  import type { CatalogClient } from '$lib/search/client.js';
  import type {
    BrowseState,
    ChosenEdition,
    DetailContext,
    DetailState,
    TracklistState,
  } from '$lib/search/detail.js';
  import type { TypingDriver } from '$lib/search/typing.js';
  import type { EntityFilter, EntityKind } from '$lib/search/view.js';

  interface Properties {
    /** Action-failure message from a rejected submission (the native fallback's path). */
    error?: string;
    /**
     * What was submitted, echoed back so a rejected submission is corrected rather than retyped.
     * `kind` says WHICH form was refused: a request made from a search result is not this page's
     * fallback form, and treating every refusal as that form's would open it under a message about
     * something else entirely.
     */
    values?: Record<string, string | undefined>;
    /** The catalog conversation — injected so the surface can be driven without a server. */
    catalog?: CatalogClient;
    /** When typing becomes a search — injected so tests need not wait out a debounce. */
    typing?: TypingDriver;
  }

  let { error, values, catalog = httpCatalog(), typing = searchTyping }: Properties = $props();

  let query = $state('');
  let filter = $state<EntityFilter>('all');
  let outcome = $state<SearchOutcome | undefined>();
  let failure = $state<string | undefined>();
  let searching = $state(false);
  let detail = $state<DetailState | undefined>();
  let tracklists = $state<Record<string, TracklistState>>({});
  /** The pressing chosen by hand, if any — see `chosenEdition` for why it carries its album. */
  let chosen = $state<ChosenEdition | undefined>();

  /** The search in flight, abandoned as soon as a newer one starts. */
  let inFlight: AbortController | undefined;
  /**
   * The search the last keystroke scheduled. Enter does not change the query, so the effect that
   * owns this teardown does not re-run — without cancelling it here, pressing Enter would search
   * now and then search the same thing again when the debounce came due.
   */
  let cancelScheduled: (() => void) | undefined;

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
    outcome = undefined;
    failure = undefined;
  }

  /**
   * Run a catalog conversation, and let a rejection be a bug rather than a stuck page.
   *
   * Nothing SHOULD reject — the client converts every failure to a value — so a rejection is a
   * bug, and the least debuggable way for one to surface is a spinner that never stops. Each
   * conversation therefore hands in its OWN recovery: they set different loading state before
   * they await (the page's "Searching…", the detail view's "Reading the catalog…", a
   * disclosure's tracklist), and a single page-level banner would leave the other two spinning —
   * the tracklist one permanently, since a tracklist already being read is never asked for again.
   */
  async function attempt(conversation: Promise<void>, recover: () => void): Promise<void> {
    try {
      await conversation;
    } catch (error_: unknown) {
      console.error('catalog conversation rejected', error_);
      recover();
    }
  }

  function run(text: string): void {
    inFlight?.abort();
    const controller = new AbortController();
    inFlight = controller;
    failure = undefined;
    // Searching is asking a new question, however it was asked — typed, or pressed. An artist's
    // releases left on screen over the answer would be answering the old one.
    browse = undefined;
    void attempt(
      runSearch(catalog, text, controller.signal, {
        onSearching: (value) => (searching = value),
        onOutcome: (value) => (outcome = value),
        onFailure: (message) => {
          failure = message;
          outcome = undefined;
        },
      }),
      () => {
        searching = false;
        failure = UNEXPECTED;
        outcome = undefined;
      },
    );
  }

  /**
   * Open a result, and let the read know whether it is still the one being waited for: opening a
   * second result, or closing the surface, must not be undone by the first read arriving late.
   */
  /** The result the open view was opened from, so closing it puts the cursor back there. */
  let openedFrom: HTMLElement | undefined;

  /** The search box, so a filter tab can hand the cursor back to where typing goes. */
  let searchBox = $state<HTMLInputElement | undefined>();

  /** The artist whose releases have taken over the results area, when one has. */
  let browse = $state<BrowseState | undefined>();

  /** Back to the results that were held all along — no second search, and the same scroll. */
  const backToResults = (): void => (browse = undefined);

  /**
   * Filtering is about the held results, so it is also the way out of an artist's releases: a tab
   * that narrowed something nobody is looking at would be dead. One function, so the page's tabs
   * and any filter link inside the results cannot disagree about that.
   */
  function filterResults(next: EntityFilter): void {
    backToResults();
    filter = next;
  }

  function browseArtistFor(mbid: string, name: string): void {
    detail = undefined;
    void attempt(
      browseArtist(
        catalog,
        mbid,
        name,
        (opened) => (browse = opened),
        () => browse?.mbid === mbid,
      ),
      () => (browse = { kind: 'failed', mbid, name, message: UNEXPECTED }),
    );
  }

  function openDetailFor(
    kind: EntityKind,
    mbid: string,
    context: DetailContext,
    from: HTMLElement,
  ): void {
    // The card that was activated — not whatever happens to hold focus — is what the cursor goes
    // back to when this closes.
    openedFrom = from;
    if (kind === 'artist') {
      browseArtistFor(mbid, context.title);
      return;
    }
    tracklists = {};
    // What is open IS what was last asked for — `detail` is set synchronously to `loading` before
    // any read starts — so the view is asked rather than tracked a second time alongside it.
    void attempt(
      openDetail(
        catalog,
        kind,
        mbid,
        context,
        (opened) => (detail = opened),
        () => detail?.mbid === mbid,
      ),
      () => (detail = { kind: 'failed', mbid, ...context, message: UNEXPECTED }),
    );
  }

  function searchNow(): void {
    cancelScheduled?.();
    cancelScheduled = undefined;
    startTyping(query, true, typing, { clear, search: run });
  }

  // `startTyping` returns the way to abandon the search it scheduled. It is kept in
  // `cancelScheduled` so `searchNow` can abandon it — Enter does not change `query`, so this effect
  // does not re-run — and ALSO returned as the effect's teardown, which is what abandons it when
  // the query changes. Dropping either one leaves a debounce running that should not be.
  // (Effects do not run during SSR, so the server renders the pre-search page and the browser
  // takes it from there.)
  $effect(() => {
    cancelScheduled = startTyping(query, false, typing, { clear, search: run });
    return () => {
      cancelScheduled?.();
      cancelScheduled = undefined;
    };
  });
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
      bind:this={searchBox}
      bind:value={query}
      onkeydown={(event) => {
        if (event.key !== 'Enter') {
          return;
        }

        event.preventDefault();
        searchNow();
      }}
      data-testid="catalog-query"
      {@attach (element: HTMLInputElement) => element.focus()}
    />
    {#if searching}
      <span class="searching" role="status" data-testid="searching">Searching…</span>
    {/if}
  </div>

  <nav class="entity-filter" aria-label="Kind of result">
    {#each FILTERS as option (option.value)}
      <button
        type="button"
        class="btn"
        aria-pressed={filter === option.value}
        onclick={() => {
          filterResults(option.value);
          // Back to the box: filtering is a step within searching, and the next thing a person
          // does is almost always type.
          searchBox?.focus();
        }}
      >
        {option.label}
      </button>
    {/each}
  </nav>

  {#if failure !== undefined}
    <p class="error" role="alert" data-testid="search-error">{failure}</p>
  {:else if outcome?.kind === 'unknown-id'}
    <p class="empty-results" data-testid="unknown-id">
      No release, artist, or track in the catalog carries that MusicBrainz ID. Check that it was
      copied whole, or search for the record by name instead.
    </p>
  {:else if browse !== undefined}
    <div class="browse-head">
      <h2>Albums by {browse.name}</h2>
      <!-- The results were held all along, so going back is not a second search. -->
      <button type="button" class="linkish" data-testid="back-to-results" onclick={backToResults}>
        Back to results
      </button>
    </div>
    {#if browse.kind === 'loading'}
      <p class="detail-status" data-testid="browse-loading">Reading the catalog…</p>
    {:else if browse.kind === 'failed'}
      <p class="error" role="alert" data-testid="browse-error">{browse.message}</p>
    {:else if browse.discography.releaseGroups.length === 0}
      <p class="empty-results" data-testid="discography-empty">
        The catalog lists no releases under this artist.
      </p>
    {:else}
      <!-- The same grid the search results use: an artist's albums ARE albums, so they get the
           artwork, the one-click request, and the click through to an album's editions. -->
      <CatalogResults
        results={asBrowsedResults(browse.discography)}
        filter="release-group"
        onOpen={openDetailFor}
        onFilter={filterResults}
      />
    {/if}
  {:else if outcome?.kind === 'results'}
    <CatalogResults
      results={outcome.results}
      {filter}
      {query}
      onOpen={openDetailFor}
      onFilter={filterResults}
    />
  {:else if !searching}
    <p class="search-hint" data-testid="search-hint">
      Search the catalog by artist, album, or track — results appear as you type, or press Enter to
      search right away. Have the exact ID? Paste a MusicBrainz ID into the same box, like
      <code>19847822-1430-3380-9cf1-bc45545b34ac</code>.
    </p>
  {/if}

  <CatalogDetail
    {detail}
    {tracklists}
    onTracklist={(mbid) =>
      void attempt(
        readTracklist(catalog, mbid, tracklists, (update) => (tracklists = update(tracklists))),
        () => (tracklists = { ...tracklists, [mbid]: { kind: 'failed', message: UNEXPECTED } }),
      )}
    {chosen}
    {values}
    onChoose={(edition) => (chosen = edition)}
    onClose={() => {
      detail = undefined;
      // Back to the result it was opened from. Without this the cursor lands at the top of the
      // document, and a keyboard user has to walk the whole page back to where they were.
      openedFrom?.focus();
      openedFrom = undefined;
    }}
  />

  <!-- Open when THIS form's submission was refused: the message names a field in a form that is
       otherwise folded away, and pointing at something invisible is not pointing at anything. A
       refusal of a request made from a result is not this form's, and opening it there would sit
       the message above a form the person never touched. -->
  <details class="native-request" open={values?.kind === 'descriptor'}>
    <summary>Request by artist and title</summary>
    <!-- Enhanced like every other request form: this is the one carrying free text, so it is the
         one most likely to come back refused — and without JavaScript it is still a plain POST. -->
    <form method="POST" data-testid="native-form" use:enhance>
      <label>
        Artist
        <input name="artist" data-testid="native-artist" value={values?.artist ?? ''} />
      </label>
      <label>
        Title
        <input name="title" data-testid="native-title" value={values?.title ?? ''} />
      </label>
      <label>
        What to request
        <select name="targetType" data-testid="native-target">
          <!-- Explicit per-option `selected` (not select-level `value`): the compiler's
               select_value helper emits a nullish guard our fallback makes unreachable. -->
          <option value="album" selected={(values?.targetType ?? 'album') === 'album'}>
            An album
          </option>
          <option value="track" selected={values?.targetType === 'track'}>A single track</option>
        </select>
      </label>
      <input type="hidden" name="kind" value="descriptor" />
      <RequestPolicies {values} />
      <button type="submit" class="btn primary">Request download</button>
    </form>
  </details>
</div>

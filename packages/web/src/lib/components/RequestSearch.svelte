<script lang="ts">
  import CatalogDetail from './CatalogDetail.svelte';
  import CatalogResults from './CatalogResults.svelte';
  import RequestPolicies from './RequestPolicies.svelte';
  import { enhance } from '$app/forms';
  import { UNEXPECTED, httpCatalog } from '$lib/search/client.js';
  import { openDetail, readTracklist, runSearch } from '$lib/search/session.js';
  import type { SearchOutcome } from '$lib/search/session.js';
  import { searchTyping, startTyping } from '$lib/search/typing.js';
  import type { CatalogClient } from '$lib/search/client.js';
  import type {
    DetailContext,
    DetailState,
    EditionPin,
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
  /** The pressing chosen by hand, if any — see `activeEdition` for why it carries its album. */
  let pin = $state<EditionPin | undefined>();

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
  function openDetailFor(kind: EntityKind, mbid: string, context: DetailContext): void {
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
        class="btn"
        aria-pressed={filter === option.value}
        onclick={() => (filter = option.value)}
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
  {:else if outcome?.kind === 'results'}
    <CatalogResults
      results={outcome.results}
      {filter}
      {query}
      onOpen={openDetailFor}
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
      void attempt(
        readTracklist(catalog, mbid, tracklists, (update) => (tracklists = update(tracklists))),
        () => (tracklists = { ...tracklists, [mbid]: { kind: 'failed', message: UNEXPECTED } }),
      )}
    {pin}
    {values}
    onPin={(chosen) => (pin = chosen)}
    onClose={() => (detail = undefined)}
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

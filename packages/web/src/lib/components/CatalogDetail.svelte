<script lang="ts">
  import {
    FORMAT_CATEGORIES,
    chosenEdition,
    bestMatchSummary,
    detailSubtitle,
    editionSummary,
    narrowedToFormat,
    groupHeading,
    pickedMbid,
    trackTime,
  } from '$lib/search/detail.js';
  import { artUrl, initialsOf } from '$lib/search/view.js';
  import CoverArt from './CoverArt.svelte';
  import RequestForm from './RequestForm.svelte';
  import RequestPolicies from './RequestPolicies.svelte';
  import type {
    DetailState,
    ChosenEdition,
    FormatCategory,
    TracklistState,
  } from '$lib/search/detail.js';

  interface Properties {
    /** What is open, and what has been read about it so far; nothing when nothing is open. */
    detail: DetailState | undefined;
    /** Tracklists the person has asked to see, keyed by the edition read from. */
    tracklists: Record<string, TracklistState>;
    /** Ask for one edition's running order — read only when asked for. */
    onTracklist: (mbid: string) => void;
    /**
     * The edition chosen by hand, and the album it was chosen on. Held by the surface that owns
     * the page's state rather than here, so this component stays a function of its props — and so
     * the choice can be rendered on the server, where nothing can be clicked.
     */
    chosen: ChosenEdition | undefined;
    /** Choose a pressing to request, or (with nothing) go back to the system's own default. */
    onChoose: (edition?: ChosenEdition) => void;
    /** What a refused submission carried, so its policies are corrected rather than retyped. */
    values?: Record<string, string | undefined>;
    onClose: () => void;
  }

  let { detail, tracklists, onTracklist, chosen, onChoose, values, onClose }: Properties = $props();

  const chosenHere = $derived(chosenEdition(detail, chosen));
  /** Which shelf of pressings is being looked at. Narrowing is a view of the same listing. */
  let format = $state<FormatCategory>('all');
  const FORMAT_LABELS: Record<FormatCategory, string> = {
    all: 'All',
    cd: 'CD',
    vinyl: 'Vinyl',
    digital: 'Digital',
    other: 'Other',
  };

  /** An edition's own name, plus whatever the catalog says makes it different. */
  const editionTitle = (edition: { title: string; disambiguation?: string | undefined }): string =>
    edition.disambiguation === undefined
      ? edition.title
      : `${edition.title} (${edition.disambiguation})`;
</script>

{#if detail !== undefined}
  <!-- Who made it, when, and what kind — from what the result card already had on screen. -->
  {@const subtitle = detailSubtitle(detail)}
  <!-- An overlay, so it says what it is and can be left the way an overlay is left. -->
  <div
    class="catalog-detail"
    data-testid="detail"
    role="dialog"
    aria-modal="false"
    aria-label={detail.title}
    tabindex="-1"
    {@attach (element: HTMLElement) => element.focus()}
    onkeydown={(event) => {
      if (event.key === 'Escape') onClose();
    }}
  >
    <header class="detail-head">
      <h2>{detail.title}</h2>
      <button type="button" class="btn detail-close" onclick={onClose}>Close</button>
    </header>

    {#if detail.kind === 'loading'}
      <p class="detail-status" data-testid="detail-loading">Reading the catalog…</p>
    {:else if detail.kind === 'failed'}
      <p class="error" role="alert" data-testid="detail-error">{detail.message}</p>
    {:else if detail.kind === 'release-group'}
      {@const picked = pickedMbid(detail.editions)}
      {@const summary = bestMatchSummary(detail.editions)}
      {@const shown = narrowedToFormat(detail.editions, format)}
      <CoverArt
        src={artUrl('release-group', detail.mbid, 500)}
        initials={initialsOf(detail.title)}
        shape="detail"
      />
      {#if subtitle !== ''}
        <p class="detail-subtitle">{subtitle}</p>
      {/if}
      <!-- The identifier is here because this is where someone checks they opened the right
           record, and where they copy it from to talk about it elsewhere. -->
      <p class="detail-mbid">
        <span class="eyebrow">MusicBrainz ID</span> <code>{detail.mbid}</code>
      </p>

      <h3>Edition</h3>
      {#if detail.editions.groups.length === 0}
        <!-- No editions to show is not "no default": it is the catalog telling us nothing, and
             saying "choose one" above an empty list is a confident dead end. -->
        <p class="detail-status" data-testid="editions-unknown">
          The catalog lists no pressings for this album.
        </p>
      {:else if summary.kind === 'selection-required'}
        <!-- Says WHAT the system would do, not WHY: the reason is the picker's, and a copy that
             restates its criterion becomes a falsehood the moment the picker widens. -->
        <p class="detail-status" data-testid="selection-required">
          No edition here can be chosen automatically, so the system would ask you to pick one
          before downloading.
        </p>
      {:else}
        <!-- Above the groups, and outside the format filter, because the pick regularly sits in a
             collapsed group and on a shelf nobody is looking at. It doubles as the way back to
             letting the system choose: selecting it clears any pressing chosen by hand. -->
        <button
          type="button"
          class="best-match"
          data-testid="best-match"
          aria-pressed={chosenHere === undefined}
          onclick={() => onChoose()}
        >
          <span class="eyebrow">The system would take</span>
          <span class="best-match-title">{summary.title}</span>
          {#if summary.detail !== ''}
            <span class="edition-summary">{summary.detail}</span>
          {/if}
        </button>
      {/if}

      {#if detail.editions.groups.length > 0}
        <div class="format-filter" role="group" aria-label="Pressing format">
          {#each FORMAT_CATEGORIES as option (option)}
            <button
              type="button"
              class="btn"
              aria-pressed={format === option}
              onclick={() => (format = option)}
            >
              {FORMAT_LABELS[option]}
            </button>
          {/each}
        </div>
      {/if}

      {@const wasNarrowedToNothing = detail.editions.groups.length > 0 && shown.groups.length === 0}
      {#if wasNarrowedToNothing}
        <!-- Built as one string: interpolating an indexed lookup compiles to a guard for a key
             this record cannot be missing. -->
        {@const nothingHere = `The catalog lists no ${FORMAT_LABELS[format]} pressings for this album.`}
        <p class="detail-status" data-testid="no-editions-in-format">{nothingHere}</p>
      {/if}

      <ul class="edition-groups">
        {#each shown.groups as group, index (group.representative.mbid)}
          {@const state = tracklists[group.representative.mbid]}
          {@const holdsThePick = group.editions.some((edition) => edition.mbid === picked)}
          <li>
            <!-- The most-common tracklist, and whichever group the pick is in — a pick nobody can
                 see is a pick nobody can check. -->
            <details class="edition-group" open={index === 0 || holdsThePick}>
              <summary>
                <span>{groupHeading(group)}</span>
                {#if index === 0}<span class="edition-note">most common</span>{/if}
              </summary>

              <button
                type="button"
                class="linkish tracklist-open"
                onclick={() => onTracklist(group.representative.mbid)}
              >
                View tracklist
              </button>

              {#if state?.kind === 'loading'}
                <p class="detail-status">Reading the tracklist…</p>
              {:else if state?.kind === 'failed'}
                <p class="error" role="alert">{state.message}</p>
              {:else if state?.kind === 'loaded' && state.tracklist.tracks.length === 0}
                <p class="detail-status">The catalog lists no tracks for this pressing.</p>
              {:else if state?.kind === 'loaded'}
                <ol class="tracklist">
                  {#each state.tracklist.tracks as track (track.position)}
                    <li>
                      <span class="track-title">{track.title}</span>
                      <span class="track-time">{trackTime(track.durationMs)}</span>
                    </li>
                  {/each}
                </ol>
              {/if}

              <ul class="editions">
                {#each group.editions as edition (edition.mbid)}
                  {@const says = editionSummary(edition)}
                  <li>
                    <button
                      type="button"
                      class="edition"
                      aria-pressed={chosenHere === edition.mbid}
                      onclick={() =>
                        onChoose(
                          chosenHere === edition.mbid
                            ? undefined
                            : { album: detail.mbid, edition: edition.mbid },
                        )}
                    >
                      <span class="edition-title">{editionTitle(edition)}</span>
                      {#if says !== ''}
                        <span class="edition-summary">{says}</span>
                      {/if}
                      {#if edition.mbid === picked}
                        <span class="edition-default" data-testid="system-pick">
                          the system’s default
                        </span>
                      {/if}
                      {#if chosenHere === edition.mbid}
                        <span class="edition-chosen">chosen</span>
                      {/if}
                    </button>
                  </li>
                {/each}
              </ul>
            </details>
          </li>
        {/each}
      </ul>

      <RequestForm
        fields={chosenHere === undefined
          ? { kind: 'release-group', mbid: detail.mbid }
          : { kind: 'musicbrainz', targetType: 'album', mbid: chosenHere }}
        title={detail.title}
        label={chosenHere === undefined ? 'Request download' : 'Request this edition'}
      >
        <RequestPolicies {values} />
      </RequestForm>
    {:else if detail.kind === 'recording'}
      <!-- Bound once: read straight off `detail` in the markup, each access compiles to its own
           defensive check for a value this branch has already established. -->
      {@const release = detail.release}
      {#if release !== undefined}
        <CoverArt
          src={artUrl('release', release.mbid, 500)}
          initials={initialsOf(release.title)}
          shape="detail"
        />
      {/if}
      {#if subtitle !== ''}
        <p class="detail-subtitle">{subtitle}</p>
      {/if}
      {#if release !== undefined}
        <!-- A track is a track OF something; without this the panel is a title and a button.
             The sentence is built as one string: interpolating a field of an optional value
             compiles to a nullish guard for a case this branch already ruled out. -->
        <p class="detail-from">{`from ${release.title}`}</p>
      {/if}
      <RequestForm
        fields={{ kind: 'musicbrainz', targetType: 'track', mbid: detail.mbid }}
        title={detail.title}
        label="Request this track"
      >
        <RequestPolicies {values} />
      </RequestForm>
    {/if}
  </div>
{/if}

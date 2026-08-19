<script lang="ts">
  import { enhance } from '$app/forms';
  import {
    activeEdition,
    detailSubtitle,
    editionSummary,
    groupHeading,
    pickedMbid,
    releaseLine,
    trackTime,
  } from '$lib/search/detail.js';
  import { artUrl, initialsOf } from '$lib/search/view.js';
  import CoverArt from './CoverArt.svelte';
  import RequestPolicies from './RequestPolicies.svelte';
  import type { DetailState, EditionPin, TracklistState } from '$lib/search/detail.js';

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
    pin: EditionPin | undefined;
    /** Choose a pressing to request, or (with nothing) go back to the system's own default. */
    onPin: (pin: EditionPin | undefined) => void;
    /** What a refused submission carried, so its policies are corrected rather than retyped. */
    values?: Record<string, string | undefined>;
    onClose: () => void;
  }

  let { detail, tracklists, onTracklist, pin, onPin, values, onClose }: Properties = $props();

  /** How many requests are in flight, so a submitted form cannot be submitted again. */
  let requesting = $state(0);

  /** Enhanced submission keeps the page — which also keeps the button live for the round trip. */
  const oneAtATime = () => {
    requesting += 1;
    return async ({ update }: { update: (options: { reset: boolean }) => Promise<void> }) => {
      await update({ reset: false });
      requesting -= 1;
    };
  };

  const activePin = $derived(activeEdition(detail, pin));

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
      {:else if picked === undefined}
        <!-- Says WHAT the system would do, not WHY: the reason is the picker's, and a copy that
             restates its criterion becomes a falsehood the moment the picker widens. -->
        <p class="detail-status" data-testid="selection-required">
          No edition here can be chosen automatically, so the system would ask you to pick one
          before downloading.
        </p>
      {/if}

      <ul class="edition-groups">
        {#each detail.editions.groups as group, index (group.representative.mbid)}
          {@const state = tracklists[group.representative.mbid]}
          <li>
            <details class="edition-group" open={index === 0}>
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
                  <li>
                    <button
                      type="button"
                      class="edition"
                      aria-pressed={activePin === edition.mbid}
                      onclick={() =>
                        onPin(
                          activePin === edition.mbid
                            ? undefined
                            : { album: detail.mbid, edition: edition.mbid },
                        )}
                    >
                      <span class="edition-title">{editionTitle(edition)}</span>
                      <span class="edition-summary">{editionSummary(edition)}</span>
                      {#if edition.mbid === picked}
                        <span class="edition-default" data-testid="system-pick">
                          the system’s default
                        </span>
                      {/if}
                      {#if activePin === edition.mbid}
                        <span class="edition-pinned">chosen</span>
                      {/if}
                    </button>
                  </li>
                {/each}
              </ul>
            </details>
          </li>
        {/each}
      </ul>

      <form
        method="POST"
        action="/acquisitions/new"
        use:enhance={oneAtATime}
        class="detail-request"
      >
        {#if activePin === undefined}
          <input type="hidden" name="kind" value="release-group" />
          <input type="hidden" name="mbid" value={detail.mbid} />
        {:else}
          <input type="hidden" name="kind" value="musicbrainz" />
          <input type="hidden" name="targetType" value="album" />
          <input type="hidden" name="mbid" value={activePin} />
        {/if}
        <RequestPolicies {values} />
        <button type="submit" class="btn primary" disabled={requesting > 0}>
          {activePin === undefined ? 'Request download' : 'Request this edition'}
        </button>
      </form>
    {:else if detail.kind === 'artist'}
      <h3>Releases</h3>
      {#if detail.discography.releaseGroups.length === 0}
        <p class="detail-status" data-testid="discography-empty">
          The catalog lists no releases under this artist.
        </p>
      {/if}
      <ul class="discography">
        {#each detail.discography.releaseGroups as group (group.mbid)}
          <li>
            <span class="result-title">{group.title}</span>
            <span class="result-detail">{releaseLine(group)}</span>
            <form
              method="POST"
              action="/acquisitions/new"
              use:enhance={oneAtATime}
              class="request-form"
            >
              <input type="hidden" name="kind" value="release-group" />
              <input type="hidden" name="mbid" value={group.mbid} />
              <button type="submit" class="btn primary request" disabled={requesting > 0}>
                Request
              </button>
            </form>
          </li>
        {/each}
      </ul>
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
      <form
        method="POST"
        action="/acquisitions/new"
        use:enhance={oneAtATime}
        class="detail-request"
      >
        <input type="hidden" name="kind" value="musicbrainz" />
        <input type="hidden" name="targetType" value="track" />
        <input type="hidden" name="mbid" value={detail.mbid} />
        <RequestPolicies {values} />
        <button type="submit" class="btn primary" disabled={requesting > 0}>
          Request this track
        </button>
      </form>
    {/if}
  </div>
{/if}

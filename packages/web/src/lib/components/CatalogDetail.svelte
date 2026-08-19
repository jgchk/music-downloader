<script lang="ts">
  import {
    editionSummary,
    groupHeading,
    pickedMbid,
    releaseLine,
    trackTime,
  } from '$lib/search/detail.js';
  import { artUrl } from '$lib/search/view.js';
  import type { DetailState, TracklistState } from '$lib/search/detail.js';

  interface Properties {
    /** What is open, and what has been read about it so far; nothing when nothing is open. */
    detail: DetailState | undefined;
    /** Tracklists the person has asked to see, keyed by the edition read from. */
    tracklists: Record<string, TracklistState>;
    /** Ask for one edition's running order — read only when asked for. */
    onTracklist: (mbid: string) => void;
    onClose: () => void;
  }

  let { detail, tracklists, onTracklist, onClose }: Properties = $props();

  /** The edition to request: the one pinned here, else whatever the pipeline picks for itself. */
  let pinned = $state<string | undefined>();

  /** An edition's own name, plus whatever the catalog says makes it different. */
  const editionTitle = (edition: { title: string; disambiguation?: string | undefined }): string =>
    edition.disambiguation === undefined
      ? edition.title
      : `${edition.title} (${edition.disambiguation})`;
</script>

{#if detail !== undefined}
  <aside class="detail" data-testid="detail" aria-label={detail.title}>
    <header class="detail-head">
      <h2>{detail.title}</h2>
      <button type="button" class="detail-close" onclick={onClose}>Close</button>
    </header>

    {#if detail.kind === 'loading'}
      <p class="detail-status" data-testid="detail-loading">Reading the catalog…</p>
    {:else if detail.kind === 'failed'}
      <p class="error" role="alert" data-testid="detail-error">{detail.message}</p>
    {:else if detail.kind === 'release-group'}
      {@const picked = pickedMbid(detail.editions)}
      <img
        class="detail-art"
        src={artUrl('release-group', detail.mbid, 500)}
        alt=""
        width="500"
        height="500"
      />

      <h3>Edition</h3>
      {#if picked === undefined}
        <p class="detail-status" data-testid="selection-required">
          No edition is official here, so the system would ask you to choose one before downloading.
        </p>
      {/if}

      <ul class="edition-groups">
        {#each detail.editions.groups as group, index (group.trackCount)}
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
                      aria-pressed={pinned === edition.mbid}
                      onclick={() => (pinned = pinned === edition.mbid ? undefined : edition.mbid)}
                    >
                      <span class="edition-title">{editionTitle(edition)}</span>
                      <span class="edition-summary">{editionSummary(edition)}</span>
                      {#if edition.mbid === picked}
                        <span class="edition-default" data-testid="system-pick">
                          the system’s default
                        </span>
                      {/if}
                      {#if pinned === edition.mbid}
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

      <form method="POST" action="/acquisitions/new" class="detail-request">
        {#if pinned === undefined}
          <input type="hidden" name="kind" value="release-group" />
          <input type="hidden" name="mbid" value={detail.mbid} />
        {:else}
          <input type="hidden" name="kind" value="musicbrainz" />
          <input type="hidden" name="targetType" value="album" />
          <input type="hidden" name="mbid" value={pinned} />
        {/if}
        <label>
          Quality floor
          <select name="qualityFloor">
            <option value="">Default</option>
            <option value="LOSSLESS_HIRES">Hi-res lossless</option>
            <option value="LOSSLESS">Lossless</option>
            <option value="LOSSY_HIGH">High quality lossy</option>
            <option value="LOSSY_STANDARD">Standard lossy</option>
          </select>
        </label>
        <button type="submit" class="btn primary">
          {pinned === undefined ? 'Request download' : 'Request this edition'}
        </button>
      </form>
    {:else if detail.kind === 'artist'}
      <h3>Releases</h3>
      <ul class="discography">
        {#each detail.discography.releaseGroups as group (group.mbid)}
          <li>
            <span class="result-title">{group.title}</span>
            <span class="result-detail">{releaseLine(group)}</span>
            <form method="POST" action="/acquisitions/new" class="request-form">
              <input type="hidden" name="kind" value="release-group" />
              <input type="hidden" name="mbid" value={group.mbid} />
              <button type="submit" class="btn primary request">Request</button>
            </form>
          </li>
        {/each}
      </ul>
    {:else}
      <form method="POST" action="/acquisitions/new" class="detail-request">
        <input type="hidden" name="kind" value="musicbrainz" />
        <input type="hidden" name="targetType" value="track" />
        <input type="hidden" name="mbid" value={detail.mbid} />
        <label>
          Quality floor
          <select name="qualityFloor">
            <option value="">Default</option>
            <option value="LOSSLESS_HIRES">Hi-res lossless</option>
            <option value="LOSSLESS">Lossless</option>
            <option value="LOSSY_HIGH">High quality lossy</option>
            <option value="LOSSY_STANDARD">Standard lossy</option>
          </select>
        </label>
        <button type="submit" class="btn primary">Request this track</button>
      </form>
    {/if}
  </aside>
{/if}

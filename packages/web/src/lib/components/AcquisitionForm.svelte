<script lang="ts">
  interface Props {
    /** Action-failure message to surface (web-ui spec: actionable, not a crash). */
    error?: string;
    /** Echo of the rejected submission for repopulation. */
    values?: Record<string, string>;
  }

  let { error = undefined, values = {} }: Props = $props();
  // The prop seeds initial state only (server-renderable repopulation after a failed action).
  // svelte-ignore state_referenced_locally
  let kind = $state(values.kind ?? 'musicbrainz');
</script>

<form method="POST" data-testid="submit-form">
  {#if error}
    <p class="error" role="alert" data-testid="form-error">{error}</p>
  {/if}

  <label>
    Request kind
    <select name="kind" bind:value={kind} data-testid="kind">
      <option value="musicbrainz">MusicBrainz release</option>
      <option value="release-group">MusicBrainz release group</option>
      <option value="descriptor">Artist / title descriptor</option>
    </select>
  </label>

  {#if kind !== 'release-group'}
    <label>
      Target type
      <!-- Explicit per-option `selected` (not select-level `value`): the compiler's select_value
           helper emits a nullish guard our `??` fallback makes unreachable (spike rule). -->
      <select name="targetType" data-testid="target-type">
        <option value="album" selected={(values.targetType ?? 'album') === 'album'}>Album</option>
        <option value="track" selected={values.targetType === 'track'}>Track</option>
      </select>
    </label>
  {/if}

  {#if kind === 'musicbrainz' || kind === 'release-group'}
    <label>
      {kind === 'release-group' ? 'MusicBrainz release-group ID' : 'MusicBrainz ID'}
      <input name="mbid" value={values.mbid ?? ''} data-testid="mbid" />
    </label>
  {:else}
    <label>
      Artist
      <input name="artist" value={values.artist ?? ''} data-testid="artist" />
    </label>
    <label>
      Title
      <input name="title" value={values.title ?? ''} />
    </label>
    <label>
      Album (optional, for track requests)
      <input name="album" value={values.album ?? ''} />
    </label>
  {/if}

  <details>
    <summary>Policies (optional)</summary>
    <label>
      Quality floor
      <select name="qualityFloor">
        <option value="" selected={(values.qualityFloor ?? '') === ''}>(default)</option>
        <option value="LOSSLESS_HIRES" selected={values.qualityFloor === 'LOSSLESS_HIRES'}>
          Lossless hi-res
        </option>
        <option value="LOSSLESS" selected={values.qualityFloor === 'LOSSLESS'}>Lossless</option>
        <option value="LOSSY_HIGH" selected={values.qualityFloor === 'LOSSY_HIGH'}
          >Lossy high</option
        >
        <option value="LOSSY_STANDARD" selected={values.qualityFloor === 'LOSSY_STANDARD'}>
          Lossy standard
        </option>
        <option value="LOSSY_LOW" selected={values.qualityFloor === 'LOSSY_LOW'}>Lossy low</option>
      </select>
    </label>
    <label>
      Quality order (comma-separated buckets)
      <input name="qualityOrder" value={values.qualityOrder ?? ''} />
    </label>
    <label>
      Match threshold (0–1)
      <input name="matchThreshold" inputmode="decimal" value={values.matchThreshold ?? ''} />
    </label>
    <label>
      Max search rounds
      <input name="maxSearchRounds" inputmode="numeric" value={values.maxSearchRounds ?? ''} />
    </label>
    <label>
      Max total attempts
      <input name="maxTotalAttempts" inputmode="numeric" value={values.maxTotalAttempts ?? ''} />
    </label>
    <label>
      Time budget (ms)
      <input name="timeBudgetMs" inputmode="numeric" value={values.timeBudgetMs ?? ''} />
    </label>
    <label>
      Stall timeout (ms)
      <input name="stallTimeoutMs" inputmode="numeric" value={values.stallTimeoutMs ?? ''} />
    </label>
    <label>
      Max queue wait (ms)
      <input name="maxQueueWaitMs" inputmode="numeric" value={values.maxQueueWaitMs ?? ''} />
    </label>
  </details>

  <button type="submit">Request download</button>
</form>

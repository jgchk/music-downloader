<script lang="ts">
  interface Properties {
    /**
     * Where this artwork is served from — absent when the catalog kind has no cover to ask for
     * (an artist), in which case the placeholder is the whole of it.
     */
    src?: string | undefined;
    /** What the placeholder says: the subject's initials, so an empty slot still names something. */
    initials: string;
    /** The slot's shape hook — a round artist bubble, a row thumbnail, the detail panel's square. */
    shape?: 'art-artist' | 'art-thumb' | 'art-detail' | undefined;
  }

  let { src, initials, shape }: Properties = $props();

  /**
   * A cover that fails paints the browser's own broken-image mark over the placeholder that is
   * meant to stand in for it — so a failed cover stops being rendered at all. CSS cannot express
   * this: there is no selector for an image that errored.
   */
  let failed = $state(false);
</script>

<span class={shape === undefined ? 'art' : `art ${shape}`}>
  {#if src !== undefined && !failed}
    <img
      {src}
      alt=""
      loading="lazy"
      width="250"
      height="250"
      onerror={() => {
        failed = true;
      }}
    />
  {/if}
  <span class="art-placeholder" aria-hidden="true">{initials}</span>
</span>

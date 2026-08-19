<script lang="ts" module>
  /** Where an artwork slot is being rendered — the caller says the place, not the class name. */
  export type ArtSlot = 'card' | 'artist' | 'thumb' | 'detail';

  /**
   * The one place the slot's presentation hooks are named. Keeping the class strings here rather
   * than in the prop's type means a stylesheet rename is a one-line change instead of a contract
   * change at every call site — and the set of slots stays readable from the type alone.
   */
  const SLOTS: Record<ArtSlot, { readonly classes: string; readonly eager: boolean }> = {
    card: { classes: 'art', eager: false },
    artist: { classes: 'art art-artist', eager: false },
    thumb: { classes: 'art art-thumb', eager: false },
    // The panel's cover is on screen the moment the panel is, so there is nothing to defer.
    detail: { classes: 'art art-detail', eager: true },
  };
</script>

<script lang="ts">
  interface Properties {
    /**
     * Where this artwork is served from — absent when there is nothing to ask for: an artist, or
     * a track the catalog names no release for. The placeholder is then the whole of it.
     */
    src?: string | undefined;
    /** What the placeholder says: the subject's initials, so an empty slot still names something. */
    initials: string;
    /** Which slot this is. Defaults to the grid card, the shape most results wear. */
    shape?: ArtSlot | undefined;
  }

  let { src, initials, shape = 'card' }: Properties = $props();

  /**
   * WHICH cover failed, not merely that one did. A bare boolean would outlive the `src` it was
   * about: a slot reused for a second subject — a re-search that repoints a row, a panel that
   * swaps albums without unmounting — would go on hiding a cover that loads perfectly well.
   *
   * The image is dropped rather than left to fail in place because an errored `<img>` paints the
   * browser's own broken-image mark over the placeholder that is meant to stand in for it, and
   * CSS has no selector for an image that errored.
   *
   * Nothing is logged here on purpose: most records simply have no cover, so absence and outage
   * arrive as the same `error` event and a line here would be a flood, not a signal. The archive
   * fault is recorded server-side, where the two can still be told apart — see the cover-art
   * route, which logs the upstream fault and refuses to remember it.
   */
  let failedSource = $state<string | undefined>();

  const showing = $derived(src !== undefined && src !== failedSource);
</script>

<span class={SLOTS[shape].classes}>
  {#if showing && src !== undefined}
    <!-- The width/height pair says only that the slot is square; the reserved box comes from CSS
         (`.art` has `aspect-ratio: 1` and the image fills it), so the numbers are a hint, not a size. -->
    <img
      {src}
      alt=""
      loading={SLOTS[shape].eager ? 'eager' : 'lazy'}
      width="250"
      height="250"
      onerror={() => {
        failedSource = src;
      }}
    />
  {/if}
  <span class="art-placeholder" aria-hidden="true">{initials}</span>
</span>

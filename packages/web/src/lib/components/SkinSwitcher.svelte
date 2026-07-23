<script lang="ts" module>
  export const SKINS = ['forum', 'glass', 'terminal'] as const;
  export type Skin = (typeof SKINS)[number];
  export const isSkin = (value: string | undefined): value is Skin =>
    (SKINS as readonly string[]).includes(value ?? '');
</script>

<script lang="ts">
  // The active skin lives on `<html data-skin>`; a no-flash script in app.html has
  // already resolved any stored preference before paint. This control only mirrors and
  // mutates that attribute — the theme is the attribute, not this component's state. It
  // is a progressive enhancement: with no scripting, the server-rendered default stands.
  let active = $state<Skin>('forum');

  // Client-only (effects never run during SSR), so no `document` access on the server;
  // corrects the pressed state to the resolved skin after hydration without a mismatch.
  $effect(() => {
    const current = document.documentElement.dataset.skin;
    if (isSkin(current)) active = current;
  });

  function choose(skin: Skin): void {
    active = skin;
    document.documentElement.dataset.skin = skin;
    try {
      localStorage.setItem('skin', skin);
    } catch {
      // Storage may be unavailable (private mode); the in-page switch still works.
    }
  }
</script>

<div class="segmented skin-switch" role="group" aria-label="Theme">
  {#each SKINS as skin (skin)}
    <button type="button" aria-pressed={active === skin} onclick={() => choose(skin)}>
      {skin}
    </button>
  {/each}
</div>

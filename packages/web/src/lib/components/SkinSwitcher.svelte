<script lang="ts">
  import { SKINS, DEFAULT_SKIN, isSkin, type Skin } from '$lib/skins.js';

  // The active skin lives on `<html data-skin>`; a no-flash script in app.html has already
  // resolved any stored preference before paint. This control only mirrors and mutates that
  // attribute — the theme is the attribute, not this component's state. It is a progressive
  // enhancement: with no scripting, the server-rendered default stands.
  let active = $state<Skin>(DEFAULT_SKIN);

  // Client-only (effects never run during SSR), so no `document` access on the server; corrects
  // the pressed state to the resolved skin after hydration without a mismatch.
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

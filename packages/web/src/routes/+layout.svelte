<script lang="ts">
  import type { LayoutProps } from './$types';
  // Global style system: tokens (the switchboard) → base (semantic elements) →
  // skins. Import order is the cascade order; base must precede the skins. The
  // active skin is chosen by `data-skin` on <html> (see app.html) and can be
  // swapped at runtime to restyle AND re-lay-out the whole app with no DOM change.
  import '$lib/styles/tokens.css';
  import '$lib/styles/base.css';
  import '$lib/styles/skins/glass.css';
  import '$lib/styles/skins/terminal.css';
  import '$lib/styles/skins/forum.css';
  import SkinSwitcher from '$lib/components/SkinSwitcher.svelte';

  let { data, children }: LayoutProps = $props();
</script>

<div class="app">
  <header class="masthead">
    <a class="wordmark" href="/"><span class="mark" aria-hidden="true">▚</span> music</a>
    <span class="spacer"></span>
    <a class="btn primary" href="/acquisitions/new"><span aria-hidden="true">＋</span> Request a download</a>
    <SkinSwitcher />
  </header>

  <nav class="primary" data-testid="site-nav" aria-label="Primary">
    <ul>
      <li><a href="/">Home</a></li>
      <li><a href="/acquisitions">Acquisitions</a></li>
      <li>
        <a href="/reviews">
          Needs attention
          {#if data.attentionCount > 0}
            <span class="badge" data-testid="attention-badge">{data.attentionCount}</span>
          {/if}
        </a>
      </li>
    </ul>
  </nav>

  <main>
    {@render children()}
  </main>

  <footer class="statusbar">
    <span>music — downloader &amp; importer</span>
    <span class="spacer"></span>
    <span class="note">beets is the system of record</span>
  </footer>
</div>

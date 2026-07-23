<script lang="ts">
  import type { LayoutProps } from './$types';
  // Global style system, kept in tokens → base → skin order for readability. Order isn't
  // load-bearing: every skin rule is scoped under `:root[data-skin=…]` and wins by specificity.
  // The active skin is chosen by `data-skin` on <html> (see app.html) and can be swapped at
  // runtime to restyle AND re-lay-out the whole app with no DOM change.
  import '$lib/styles/tokens.css';
  import '$lib/styles/base.css';
  import '$lib/styles/skins/glass.css';
  import '$lib/styles/skins/terminal.css';
  import '$lib/styles/skins/forum.css';
  import SkinSwitcher from '$lib/components/SkinSwitcher.svelte';

  let { data, children }: LayoutProps = $props();

  // SvelteKit does not set `aria-current` for us; derive it from the server-provided pathname so
  // the skins' selected-tab styling (and screen-reader wayfinding) engages on first paint. Section
  // links stay current across their child routes (e.g. Acquisitions on /acquisitions/[id]).
  function isCurrent(href: string): boolean {
    const path = data.pathname;
    return href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`);
  }
</script>

<div class="app">
  <header class="masthead">
    <a class="wordmark" href="/"><span class="mark" aria-hidden="true">▚</span> music</a>
    <span class="spacer"></span>
    <a class="btn primary" href="/acquisitions/new"
      ><span aria-hidden="true">＋</span> Request a download</a
    >
    <SkinSwitcher />
  </header>

  <nav class="primary" data-testid="site-nav" aria-label="Primary">
    <ul>
      <li><a href="/" aria-current={isCurrent('/') ? 'page' : undefined}>Home</a></li>
      <li>
        <a href="/acquisitions" aria-current={isCurrent('/acquisitions') ? 'page' : undefined}>
          Acquisitions
        </a>
      </li>
      <li>
        <a href="/reviews" aria-current={isCurrent('/reviews') ? 'page' : undefined}>
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

<script lang="ts">
  import type { LayoutProps } from './$types';

  let { data, children }: LayoutProps = $props();
</script>

<nav data-testid="site-nav">
  <a href="/">Home</a>
  <a href="/acquisitions">Acquisitions</a>
  <a href="/reviews">
    Needs attention
    {#if data.attentionCount > 0}
      <span class="badge" data-testid="attention-badge">{data.attentionCount}</span>
    {/if}
  </a>
</nav>

{@render children()}

<script lang="ts">
  import type { SectionView } from '$lib/landing.js';

  interface Properties {
    /** Each stat parsed at the load into a discriminated view — a degraded read is its own variant. */
    acquisitions: SectionView;
    pendingReviews: SectionView;
  }

  let { acquisitions, pendingReviews }: Properties = $props();
</script>

<h1>Dashboard</h1>
<dl class="stats">
  <div>
    <dt>Acquisitions</dt>
    {#if acquisitions.kind === 'unavailable'}
      <dd class="error" role="alert" data-testid="acquisition-error">{acquisitions.message}</dd>
    {:else}
      <dd data-testid="acquisition-count">{acquisitions.count}</dd>
    {/if}
  </div>
  <div>
    <dt>Pending reviews</dt>
    {#if pendingReviews.kind === 'unavailable'}
      <dd class="error" role="alert" data-testid="review-error">{pendingReviews.message}</dd>
    {:else}
      <dd data-testid="review-count">{pendingReviews.count}</dd>
    {/if}
  </div>
</dl>

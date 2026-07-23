<script lang="ts">
  interface Properties {
    counts: { acquisitions: number; pendingReviews: number };
    /** Per-section modeled failures — a degraded read shows an apology, never a false zero. */
    errors?: { acquisitions?: string; pendingReviews?: string };
  }

  let { counts, errors = {} }: Properties = $props();
</script>

<h1>Dashboard</h1>
<dl class="stats">
  <div>
    <dt>Acquisitions</dt>
    {#if errors.acquisitions !== undefined}
      <dd class="error" role="alert" data-testid="acquisition-error">{errors.acquisitions}</dd>
    {:else}
      <dd data-testid="acquisition-count">{counts.acquisitions}</dd>
    {/if}
  </div>
  <div>
    <dt>Pending reviews</dt>
    {#if errors.pendingReviews !== undefined}
      <dd class="error" role="alert" data-testid="review-error">{errors.pendingReviews}</dd>
    {:else}
      <dd data-testid="review-count">{counts.pendingReviews}</dd>
    {/if}
  </div>
</dl>

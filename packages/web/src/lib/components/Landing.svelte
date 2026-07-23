<script lang="ts">
  interface Properties {
    counts: { acquisitions: number; pendingReviews: number };
  }

  let { counts }: Properties = $props();
</script>

<h1>Dashboard</h1>
<dl class="stats">
  <div>
    <dt>Acquisitions</dt>
    <dd data-testid="acquisition-count">{counts.acquisitions}</dd>
  </div>
  <div>
    <dt>Pending reviews</dt>
    <dd data-testid="review-count">{counts.pendingReviews}</dd>
  </div>
</dl>

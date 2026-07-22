<script lang="ts">
  interface Props {
    counts: { acquisitions: number; pendingReviews: number };
  }

  let { counts }: Props = $props();
</script>

<h1>music</h1>
<p><a href="/acquisitions/new" data-testid="new-acquisition">Request a download</a></p>
<dl>
  <dt>Acquisitions</dt>
  <dd data-testid="acquisition-count">{counts.acquisitions}</dd>
  <dt>Pending reviews</dt>
  <dd data-testid="review-count">{counts.pendingReviews}</dd>
</dl>

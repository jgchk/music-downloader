<script lang="ts">
  interface Props {
    counts: { acquisitions: number; pendingReviews: number };
  }

  let { counts }: Props = $props();
</script>

<h1>music</h1>
<nav>
  <a href="/acquisitions">Acquisitions</a>
  <a href="/acquisitions/new">Request a download</a>
  <a href="/reviews">Reviews</a>
</nav>
<dl>
  <dt>Acquisitions</dt>
  <dd data-testid="acquisition-count">{counts.acquisitions}</dd>
  <dt>Pending reviews</dt>
  <dd data-testid="review-count">{counts.pendingReviews}</dd>
</dl>

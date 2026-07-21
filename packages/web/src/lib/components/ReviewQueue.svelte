<script lang="ts">
  import type { PendingReviewDto } from '@music/importer';
  import { contextSummary, kindLabel } from '$lib/reviews.js';

  interface Props {
    reviews: readonly PendingReviewDto[];
  }

  let { reviews }: Props = $props();
</script>

{#if reviews.length === 0}
  <p data-testid="empty">Nothing awaits review.</p>
{:else}
  <ul>
    {#each reviews as pending (pending.importId)}
      <li data-testid="review-row">
        <a href={`/reviews/${pending.importId}`}>{pending.path}</a>
        <span class="chip" data-kind={pending.review.kind}>{kindLabel(pending.review.kind)}</span>
        <span data-testid="context">{contextSummary(pending)}</span>
      </li>
    {/each}
  </ul>
{/if}

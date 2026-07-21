<script lang="ts">
  import ReviewQueue from '$lib/components/ReviewQueue.svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
</script>

<h1>Reviews</h1>
<ReviewQueue reviews={data.list.reviews} />

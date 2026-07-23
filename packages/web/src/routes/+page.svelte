<script lang="ts">
  import Landing from '$lib/components/Landing.svelte';
  import type { PageProps as PageProperties } from './$types';

  let { data }: PageProperties = $props();
</script>

<Landing acquisitions={data.acquisitions} pendingReviews={data.pendingReviews} />

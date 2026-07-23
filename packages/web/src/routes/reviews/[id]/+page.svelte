<script lang="ts">
  import ReviewDetail from '$lib/components/ReviewDetail.svelte';
  import type { PageProps as PageProperties } from './$types';

  let { data, form }: PageProperties = $props();
</script>

<ReviewDetail pending={data.pending} error={form?.message} />

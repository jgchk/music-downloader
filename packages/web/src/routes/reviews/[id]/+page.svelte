<script lang="ts">
  import ReviewDetail from '$lib/components/ReviewDetail.svelte';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
</script>

<ReviewDetail pending={data.pending} error={form?.message} />

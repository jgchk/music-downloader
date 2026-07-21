<script lang="ts">
  import Landing from '$lib/components/Landing.svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
</script>

<Landing counts={data.counts} />

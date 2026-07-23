<script lang="ts">
  import Landing from '$lib/components/Landing.svelte';
  import type { PageProps as PageProperties } from './$types';

  let { data }: PageProperties = $props();
</script>

<Landing counts={data.counts} errors={data.errors} />

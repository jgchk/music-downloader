<script lang="ts">
  import RequestSearch from '$lib/components/RequestSearch.svelte';
  import type { PageProps as PageProperties } from './$types';

  let { form }: PageProperties = $props();
</script>

<h1>Request a download</h1>
<RequestSearch error={form?.message} />

<script lang="ts">
  import AttentionQueue from '$lib/components/AttentionQueue.svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
</script>

<h1>Needs attention</h1>
<AttentionQueue items={data.items} errors={data.errors} />

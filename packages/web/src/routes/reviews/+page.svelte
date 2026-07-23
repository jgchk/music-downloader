<script lang="ts">
  import AttentionQueue from '$lib/components/AttentionQueue.svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
</script>

<section class="panel">
  <div class="region-head"><h1>Needs attention</h1></div>
  <AttentionQueue items={data.items} errors={data.errors} />
</section>

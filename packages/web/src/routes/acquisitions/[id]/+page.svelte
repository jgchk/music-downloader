<script lang="ts">
  import AcquisitionDetail from '$lib/components/AcquisitionDetail.svelte';
  import type { PageProps as PageProperties } from './$types';

  let { data, form }: PageProperties = $props();
</script>

<AcquisitionDetail
  acquisition={data.acquisition}
  timeline={data.timeline}
  importState={data.importState}
  progress={data.progress}
  progressUnavailable={data.progressUnavailable}
  error={form?.message}
/>

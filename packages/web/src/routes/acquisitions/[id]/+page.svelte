<script lang="ts">
  import AcquisitionDetail from '$lib/components/AcquisitionDetail.svelte';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
</script>

<AcquisitionDetail
  acquisition={data.acquisition}
  progress={data.progress}
  progressUnavailable={data.progressUnavailable}
  error={form?.message}
/>

<script lang="ts">
  import AcquisitionList from '$lib/components/AcquisitionList.svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
</script>

<h1>Acquisitions</h1>
<AcquisitionList acquisitions={data.list.acquisitions} />

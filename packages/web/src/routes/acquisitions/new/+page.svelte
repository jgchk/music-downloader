<script lang="ts">
  import AcquisitionForm from '$lib/components/AcquisitionForm.svelte';
  import type { PageProps } from './$types';

  let { form }: PageProps = $props();
</script>

<h1>Request a download</h1>
<AcquisitionForm error={form?.message} values={form?.values} />

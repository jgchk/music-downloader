<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { isTerminal } from '$lib/acquisitions.js';
  import { isImportSettled } from '$lib/copy.js';
  import { detailFreshness } from '$lib/freshness.js';
  import AcquisitionDetail from '$lib/components/AcquisitionDetail.svelte';
  import type { PageProps as PageProperties } from './$types';

  let { data, form }: PageProperties = $props();

  // Re-fetch the page's own data while the story is unsettled (design D8): the freshness module is
  // the swappable seam deciding *when*, `invalidateAll` re-runs the existing load — no new wire
  // contract. Terminal pages rest. Client-only by construction ($effect is compiled out of SSR);
  // the interval driver itself is unit-tested in $lib/freshness.
  $effect(() => {
    const settled =
      isTerminal(data.acquisition) && isImportSettled(data.importState, data.importStatus);
    if (settled) return;
    return detailFreshness.start(() => {
      void invalidateAll();
    });
  });
</script>

<AcquisitionDetail
  acquisition={data.acquisition}
  timeline={data.timeline}
  importState={data.importState}
  importStatus={data.importStatus}
  progress={data.progress}
  progressUnavailable={data.progressUnavailable}
  error={form?.message}
  nowIso={data.now}
/>

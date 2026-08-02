<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { isStorySettled } from '$lib/copy.js';
  import { detailFreshness, startLiveness } from '$lib/freshness.js';
  import AcquisitionDetail from '$lib/components/AcquisitionDetail.svelte';
  import type { PageProps as PageProperties } from './$types';

  let { data, form }: PageProperties = $props();

  /** A liveness re-fetch failed; surfaced beside the timeline instead of silently going stale. */
  let refreshFailed = $state(false);

  // Re-fetch the page's own data while the story is unsettled (design D8): the freshness module is
  // the swappable seam deciding *when*, `invalidateAll` re-runs the existing load — no new wire
  // contract. Settled stories rest. The effect re-registers on every data change (each tick
  // replaces `data`), tearing down and re-creating the interval — deliberate, not a leak: the
  // fresh interval keeps ticking from now. Client-only by construction ($effect is compiled out of
  // SSR); the whole liveness policy is unit-tested as startLiveness in $lib/freshness.
  $effect(() =>
    startLiveness(isStorySettled(data.acquisition, data.importSection), detailFreshness, {
      refresh: invalidateAll,
      onRefreshFailed: (failed) => {
        refreshFailed = failed;
      },
    }),
  );
</script>

<AcquisitionDetail
  acquisition={data.acquisition}
  timeline={data.timeline}
  importSection={data.importSection}
  progress={data.progress}
  progressUnavailable={data.progressUnavailable}
  error={form?.message}
  {refreshFailed}
  nowIso={data.now}
/>

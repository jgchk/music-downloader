<script lang="ts">
  import AcquisitionList from '$lib/components/AcquisitionList.svelte';
  import type { LayoutProps as LayoutProperties } from './$types';

  // Master-detail: the list is the persistent master pane; the child route ([id] detail,
  // the new-request form, or the index placeholder) renders in the detail pane and owns the
  // page's single <h1>. The `.master-detail` grid (base.css) lays the two panes out
  // side-by-side, stacking when narrow.
  let { data, children }: LayoutProperties = $props();
</script>

<div class="master-detail">
  <section class="master panel" aria-label="Acquisitions">
    <div class="region-head"><span class="eyebrow">Queue</span></div>
    {#if data.listFailed}
      <p class="error" role="alert" data-testid="list-error">
        The download list is unavailable right now.
      </p>
    {/if}
    <AcquisitionList acquisitions={data.acquisitions} selectedId={data.selectedId} />
  </section>
  <div class="detail">
    {@render children()}
  </div>
</div>

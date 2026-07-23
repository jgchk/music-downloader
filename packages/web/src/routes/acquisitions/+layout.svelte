<script lang="ts">
  import AcquisitionList from '$lib/components/AcquisitionList.svelte';
  import type { LayoutProps } from './$types';

  // Master-detail: the list is the persistent master pane; the child route ([id] detail,
  // the new-request form, or the index placeholder) renders in the detail pane and owns the
  // page's single <h1>. CSS lays the two panes out per skin (side-by-side, or stacked when narrow).
  let { data, children }: LayoutProps = $props();
</script>

<div class="master-detail">
  <section class="master panel" aria-label="Acquisitions">
    <div class="region-head"><span class="eyebrow">Queue</span></div>
    <AcquisitionList acquisitions={data.list.acquisitions} selectedId={data.selectedId} />
  </section>
  <div class="detail">
    {@render children()}
  </div>
</div>

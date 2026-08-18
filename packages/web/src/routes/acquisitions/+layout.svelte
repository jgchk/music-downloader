<script lang="ts">
  import AcquisitionList from '$lib/components/AcquisitionList.svelte';
  import type { LayoutProps as LayoutProperties } from './$types';

  // Master-detail: the list is the persistent master pane; the child route ([id] detail,
  // the new-request form, or the index placeholder) renders in the detail pane and owns the
  // page's single <h1>. The `.master-detail` grid (base.css) lays the two panes out
  // side-by-side; narrow screens show one pane at a time instead — on a child route the master
  // is hidden (the list-detail collapse, docs/research/responsive-master-detail-ux.md), so the
  // form or detail the user asked for is not buried under the whole queue. `detail-active` marks
  // that a child route is open; the panes never swap places, so document order stays reading order.
  let { data, children }: LayoutProperties = $props();
</script>

<div class="master-detail" class:detail-active={data.detailActive}>
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
    {#if data.detailActive}
      <!-- Shown only where the queue itself is hidden (base.css): the way back to the list when it
           is off screen. Browser back covers an in-app hop (every pane state is a real URL) but not
           a deep link, where there is no in-app history to return to — and users mid-task distrust
           it either way (research doc §3, GOV.UK). -->
      <a class="back-to-queue" href="/acquisitions" data-testid="back-to-queue">Back to queue</a>
    {/if}
    {@render children()}
  </div>
</div>

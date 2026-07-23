<script lang="ts">
  import type { AcquisitionStatusResponseDto } from '@music/downloader';
  import { statusTone, targetDescription } from '$lib/acquisitions.js';
  import AcquisitionBadge from './AcquisitionBadge.svelte';

  interface Props {
    acquisitions: readonly AcquisitionStatusResponseDto[];
    /** The acquisition currently open in the detail pane, marked as the current row. */
    selectedId?: string;
  }

  let { acquisitions, selectedId = undefined }: Props = $props();
</script>

<p><a href="/acquisitions/new" data-testid="new-acquisition">Request a download</a></p>

{#if acquisitions.length === 0}
  <p data-testid="empty">No acquisitions yet.</p>
{:else}
  <!-- A compact master list, not a table: target + a phase signal (and an attempts count). The
       full outcome / location / failure reason lives in the detail pane, so one long value can't
       overflow this narrow pane (see the acquisitions-list-detail-layout change). -->
  <ul class="queue">
    {#each acquisitions as acquisition (acquisition.acquisitionId)}
      <li>
        <a
          href={`/acquisitions/${acquisition.acquisitionId}`}
          data-testid="acquisition-row"
          aria-current={acquisition.acquisitionId === selectedId ? 'true' : undefined}
        >
          <span class="row-main">
            <span class="target" title={targetDescription(acquisition)}>
              {targetDescription(acquisition)}
            </span>
            <AcquisitionBadge phase={statusTone(acquisition.status)} />
          </span>
          {#if statusTone(acquisition.status) === 'pending' || acquisition.attempts > 0}
            <span class="row-sub">
              {#if statusTone(acquisition.status) === 'pending'}
                <!-- The tone badge collapses every in-progress state to "Working"; show the
                     granular phase so a queue you monitor still reads at a glance. -->
                <span class="phase">{acquisition.status}</span>
              {/if}
              {#if acquisition.attempts > 0}
                <span class="attempts">{acquisition.attempts} attempts</span>
              {/if}
            </span>
          {/if}
        </a>
      </li>
    {/each}
  </ul>
{/if}

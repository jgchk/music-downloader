<script lang="ts">
  import type { AcquisitionStatusResponseDto } from '@music/downloader';
  import { outcomeSummary, statusTone, targetDescription } from '$lib/acquisitions.js';
  import AcquisitionBadge from './AcquisitionBadge.svelte';

  interface Props {
    acquisitions: readonly AcquisitionStatusResponseDto[];
  }

  let { acquisitions }: Props = $props();
</script>

<p><a href="/acquisitions/new" data-testid="new-acquisition">Request a download</a></p>

{#if acquisitions.length === 0}
  <p data-testid="empty">No acquisitions yet.</p>
{:else}
  <table>
    <thead>
      <tr><th>Target</th><th>Status</th><th>Attempts</th><th>Outcome</th></tr>
    </thead>
    <tbody>
      {#each acquisitions as acquisition (acquisition.acquisitionId)}
        <tr data-testid="acquisition-row">
          <td>
            <a href={`/acquisitions/${acquisition.acquisitionId}`}>
              {targetDescription(acquisition)}
            </a>
          </td>
          <td><AcquisitionBadge phase={statusTone(acquisition.status)} /></td>
          <td>{acquisition.attempts}</td>
          <td>{outcomeSummary(acquisition) ?? acquisition.status}</td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}

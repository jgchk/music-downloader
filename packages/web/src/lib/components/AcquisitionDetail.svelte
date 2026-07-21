<script lang="ts">
  import type { AcquisitionStatusResponseDto, ProgressResponseDto } from '@music/downloader';
  import {
    isCancellable,
    outcomeSummary,
    statusTone,
    targetDescription,
  } from '$lib/acquisitions.js';
  import AcquisitionBadge from './AcquisitionBadge.svelte';
  import ProgressBar from './ProgressBar.svelte';

  interface Props {
    acquisition: AcquisitionStatusResponseDto;
    progress?: ProgressResponseDto;
    /** Cancel-action failure to surface. */
    error?: string;
  }

  let { acquisition, progress = undefined, error = undefined }: Props = $props();
</script>

<h1>{targetDescription(acquisition)}</h1>

{#if error}
  <p class="error" role="alert" data-testid="action-error">{error}</p>
{/if}

<p>
  <AcquisitionBadge phase={statusTone(acquisition.status)} />
  <span data-testid="status">{acquisition.status}</span>
  — {acquisition.attempts} attempts, {acquisition.rejectedCount} candidates rejected
</p>

{#if progress}
  <ProgressBar {progress} />
{/if}

{#if outcomeSummary(acquisition) !== undefined}
  <p data-testid="outcome">{outcomeSummary(acquisition)}</p>
{/if}

{#if acquisition.currentCandidate}
  <p data-testid="current-candidate">
    Trying {acquisition.currentCandidate.path} from {acquisition.currentCandidate.username}
  </p>
{/if}

{#if isCancellable(acquisition.status)}
  <form method="POST" action="?/cancel">
    <button type="submit" data-testid="cancel">Cancel</button>
  </form>
{/if}

<h2>History</h2>
{#if acquisition.history.length === 0}
  <p data-testid="no-history">Nothing has happened yet.</p>
{:else}
  <ol data-testid="history">
    {#each acquisition.history as entry, i (i)}
      <li>
        {#if entry.kind === 'selected'}
          Selected {entry.candidate.path} from {entry.candidate.username}
        {:else if entry.kind === 'download-failed'}
          Download failed ({entry.reason}) — {entry.candidate.path}
        {:else if entry.kind === 'validation-failed'}
          Validation failed ({entry.reasons.join(', ')}) — {entry.candidate.path}
        {:else if entry.kind === 'imported'}
          Deposited at {entry.location}
        {:else}
          Rejected after delivery ({entry.reasons.join(', ')})
        {/if}
      </li>
    {/each}
  </ol>
{/if}

<p><a href="/acquisitions">Back to acquisitions</a></p>

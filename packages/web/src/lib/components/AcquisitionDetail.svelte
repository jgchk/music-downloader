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
    /** Downloading, but the progress read failed — say so rather than render a blank bar. */
    progressUnavailable?: boolean;
    /** Cancel-action failure to surface. */
    error?: string;
  }

  let {
    acquisition,
    progress = undefined,
    progressUnavailable = false,
    error = undefined,
  }: Props = $props();
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
{:else if progressUnavailable}
  <p data-testid="progress-unavailable">
    This download is in progress, but its live progress is momentarily unavailable.
  </p>
{/if}

{#if outcomeSummary(acquisition) !== undefined}
  <p data-testid="outcome">{outcomeSummary(acquisition)}</p>
{/if}

{#if acquisition.currentCandidate}
  <p data-testid="current-candidate">
    Trying {acquisition.currentCandidate.path} from {acquisition.currentCandidate.username}
  </p>
{/if}

{#if acquisition.status === 'AwaitingManualSelection' && acquisition.candidates !== undefined}
  <h2>Choose an edition</h2>
  <p>
    This release group has no official edition, so nothing was picked automatically. Choose the
    edition to acquire.
  </p>
  <table data-testid="edition-candidates">
    <thead>
      <tr>
        <th>Title</th>
        <th>Date</th>
        <th>Country</th>
        <th>Format</th>
        <th>Tracks</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      {#each acquisition.candidates as candidate (candidate.releaseMbid)}
        <tr>
          <td>{candidate.title ?? '(untitled)'}</td>
          <td>{candidate.date ?? '—'}</td>
          <td>{candidate.country ?? '—'}</td>
          <td>{candidate.format ?? '—'}</td>
          <td>{candidate.trackCount}</td>
          <td>
            <form method="POST" action="?/select">
              <input type="hidden" name="releaseMbid" value={candidate.releaseMbid} />
              <button type="submit" data-testid="select-edition">Choose</button>
            </form>
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
{:else if acquisition.status === 'AwaitingManualSelection'}
  <!-- Defensive: the projection always carries candidates in this phase; if a stale or drifted
       reader ever sees none, say so instead of presenting a silent dead end. -->
  <p data-testid="no-candidates">
    This acquisition is waiting for an edition selection, but no candidate editions are available.
    Cancel and resubmit the request.
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
        {:else if entry.kind === 'fulfillment-rejected'}
          Rejected after delivery ({entry.reasons.join(', ')})
        {:else}
          <!-- Tolerant reader: a history kind the downloader adds later lands here rather than
               mislabeling as fulfillment-rejected and dereferencing a field it may not carry. -->
          Something happened in this acquisition.
        {/if}
      </li>
    {/each}
  </ol>
{/if}

<p><a href="/acquisitions">Back to acquisitions</a></p>

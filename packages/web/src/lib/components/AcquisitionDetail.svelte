<script lang="ts">
  import type { AcquisitionStatusResponseDto, ProgressResponseDto } from '@music/downloader';
  import {
    isCancellable,
    outcomeSummary,
    statusTone,
    targetDescription,
  } from '$lib/acquisitions.js';
  import type { TimelineEntry } from '$lib/timeline.js';
  import AcquisitionBadge from './AcquisitionBadge.svelte';
  import ProgressBar from './ProgressBar.svelte';

  interface Properties {
    acquisition: AcquisitionStatusResponseDto;
    /**
     * The download-through-import history as one timeline, composed web-side and ordered by
     * occurrence time — each entry tagged with its originating module (web-ui).
     */
    timeline?: TimelineEntry[];
    /**
     * The import section's state: `present` once handed off, `none` before, `unavailable` when the
     * importer read failed. `none`/`unavailable` still render the downloader timeline (web-ui).
     */
    importState?: 'present' | 'none' | 'unavailable';
    progress?: ProgressResponseDto;
    /** Downloading, but the progress read failed — say so rather than render a blank bar. */
    progressUnavailable?: boolean;
    /** Cancel-action failure to surface. */
    error?: string;
  }

  let {
    acquisition,
    timeline = [],
    importState = 'none',
    progress,
    progressUnavailable = false,
    error,
  }: Properties = $props();
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
          <td>{candidate.trackCount ?? '—'}</td>
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
{#if importState === 'unavailable'}
  <p data-testid="import-unavailable">
    The import side of this acquisition is currently unavailable.
  </p>
{:else if importState === 'none'}
  <p data-testid="import-none">Not yet handed off to the importer.</p>
{/if}
{#if timeline.length === 0}
  <p data-testid="no-history">Nothing has happened yet.</p>
{:else}
  <ol data-testid="history">
    {#each timeline as item, index (index)}
      <li data-module={item.module}>
        {#if item.module === 'downloader'}
          {#if item.entry.kind === 'selected'}
            Selected {item.entry.candidate.path} from {item.entry.candidate.username}
          {:else if item.entry.kind === 'download-failed'}
            Download failed ({item.entry.reason}) — {item.entry.candidate.path}
          {:else if item.entry.kind === 'validation-failed'}
            Validation failed ({item.entry.reasons.join(', ')}) — {item.entry.candidate.path}
          {:else if item.entry.kind === 'imported'}
            <!-- The downloader's "imported" is the hand-off/staging deposit, NOT the library import;
                 the importer's `applied` below is the real library import. Label them apart. -->
            Handed off to importer — staged at {item.entry.location}
          {:else if item.entry.kind === 'fulfillment-rejected'}
            Rejected after delivery ({item.entry.reasons.join(', ')})
          {:else}
            <!-- Tolerant reader: a downloader history kind added later lands here rather than
                 mislabeling and dereferencing a field it may not carry. -->
            Something happened in this acquisition.
          {/if}
        {:else}
          <span class="module-tag" data-testid="import-entry">Import</span>
          {#if item.entry.kind === 'requested'}
            Import requested
          {:else if item.entry.kind === 'proposed'}
            Matched {item.entry.candidateCount} candidate{item.entry.candidateCount === 1
              ? ''
              : 's'} against the library
          {:else if item.entry.kind === 'auto-apply-selected'}
            Auto-selected a confident match (distance {item.entry.distance})
          {:else if item.entry.kind === 'review-required'}
            Review required ({item.entry.reviewKind})
          {:else if item.entry.kind === 'review-resolved'}
            Review resolved ({item.entry.resolution})
          {:else if item.entry.kind === 'applied'}
            Imported into the library at {item.entry.location}
          {:else if item.entry.kind === 'remediation-required'}
            Applied, but needs remediation
          {:else if item.entry.kind === 'rejected'}
            Import rejected ({item.entry.reason})
          {:else if item.entry.kind === 'release-verdict-recorded'}
            Recorded a retry-download verdict ({item.entry.reasons.join(', ')})
          {:else}
            <!-- Tolerant reader: an importer history kind added later lands here safely. -->
            Something happened in the import.
          {/if}
        {/if}
      </li>
    {/each}
  </ol>
{/if}

<p><a href="/acquisitions">Back to acquisitions</a></p>

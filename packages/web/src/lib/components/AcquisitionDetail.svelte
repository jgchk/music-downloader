<script lang="ts">
  import type { AcquisitionStatusResponseDto, ProgressResponseDto } from '@music/downloader';
  import { isCancellable, parseAcquisitionView, targetDescription } from '$lib/acquisitions.js';
  import {
    entryCopy,
    isStorySettled,
    metaSummary,
    overallStatus,
    pendingRowFor,
    type EntryCopy,
  } from '$lib/copy.js';
  import { dateKey, dateLabel, durationGloss, entryTime, fullTime } from '$lib/time.js';
  import type { ImportSection, TimelineEntry } from '$lib/timeline.js';
  import AcquisitionBadge from './AcquisitionBadge.svelte';
  import ProgressBar from './ProgressBar.svelte';

  interface Properties {
    acquisition: AcquisitionStatusResponseDto;
    /**
     * The download-through-import history as one timeline, composed web-side and ordered by
     * occurrence time — each entry tagged with its originating module (web-ui). The module shapes
     * the copy but is never rendered as text: one narrator tells the whole story.
     */
    timeline?: TimelineEntry[];
    /**
     * The import side as one discriminated value: `present` carries the status, `none`/`unavailable`
     * still render the downloader timeline (web-ui). One prop, so a statusless "present" is
     * unrepresentable.
     */
    importSection?: ImportSection;
    progress?: ProgressResponseDto;
    /** Downloading, but the progress read failed — say so rather than render a blank bar. */
    progressUnavailable?: boolean;
    /** Cancel-action failure to surface. */
    error?: string;
    /** A liveness re-fetch just failed; the page shows its data may be stale (design D8). */
    refreshFailed?: boolean;
    /** The load's clock — time rendering stays a pure function of props, no wall-clock reads here. */
    nowIso: string;
    /** Test seam for deterministic absolute times; production renders in the host zone. */
    timeZone?: string;
  }

  let {
    acquisition,
    timeline = [],
    importSection = { state: 'none' },
    progress,
    progressUnavailable = false,
    error,
    refreshFailed = false,
    nowIso,
    timeZone,
  }: Properties = $props();

  // Parse the status DTO into a discriminated view at the boundary, so the template branches on a
  // view variant (whose `editions` case carries candidates) instead of re-deriving the impossible
  // "awaiting but candidates undefined" combo inline.
  const view = $derived(parseAcquisitionView(acquisition));

  const overall = $derived(overallStatus(acquisition, importSection));
  const meta = $derived(metaSummary(acquisition.attempts, acquisition.rejectedCount));
  const pending = $derived(pendingRowFor(acquisition, importSection));
  const settled = $derived(isStorySettled(acquisition, importSection));

  /**
   * The one labeled location line: the library once the import applied; else, when no import
   * section exists at all, the delivered staging drop (a present-but-unapplied import shows
   * neither — its state is the timeline's story, not a location).
   */
  const locationLine = $derived.by(() => {
    if (importSection.state === 'present' && importSection.status.status === 'applied') {
      const location = importSection.status.location;
      if (location !== undefined) return { label: 'In library at', location };
    }
    if (
      importSection.state !== 'present' &&
      acquisition.status === 'Fulfilled' &&
      acquisition.location
    ) {
      return { label: 'Delivered to', location: acquisition.location };
    }
    return;
  });

  interface RenderRow {
    readonly item: TimelineEntry;
    readonly copy: EntryCopy;
    /** A date label rendered before this row when the calendar date changes. */
    readonly divider?: string;
    /** The whole-story duration, carried by the closing row once everything has settled. */
    readonly duration?: string;
  }

  const rows: readonly RenderRow[] = $derived.by(() => {
    const rendered: RenderRow[] = [];
    let lastDate: string | undefined;
    for (const item of timeline) {
      const copy = entryCopy(item);
      if (copy === undefined) continue;
      const key = dateKey(item.at, timeZone);
      const divider =
        key !== undefined && key !== lastDate ? dateLabel(item.at, timeZone) : undefined;
      if (key !== undefined) lastDate = key;
      rendered.push({ item, copy, divider });
    }
    const first = timeline[0];
    const last = rendered.at(-1);
    if (settled && first !== undefined && last !== undefined) {
      rendered[rendered.length - 1] = { ...last, duration: durationGloss(first.at, last.item.at) };
    }
    return rendered;
  });
</script>

<h1>{targetDescription(acquisition)}</h1>

{#if error}
  <p class="error" role="alert" data-testid="action-error">{error}</p>
{/if}

<p class="status-line">
  <AcquisitionBadge phase={overall.tone} />
  <span data-testid="status">{overall.phrase}</span>
  {#if meta !== ''}
    <span class="status-meta" data-testid="status-meta">· {meta}</span>
  {/if}
</p>

{#if locationLine}
  <p class="location-line" data-testid="location">
    {locationLine.label} <span class="location-path">{locationLine.location}</span>
  </p>
{/if}

{#if view.kind === 'editions'}
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
      {#each view.candidates as candidate (candidate.releaseMbid)}
        <tr>
          <td>{candidate.title ?? '(untitled)'}</td>
          <td>{candidate.date ?? '—'}</td>
          <td>{candidate.country ?? '—'}</td>
          <td>{candidate.format ?? '—'}</td>
          <td>{candidate.trackCount ?? '—'}</td>
          <td>
            <form method="POST" action="?/select">
              <input type="hidden" name="releaseMbid" value={candidate.releaseMbid} />
              <button type="submit" class="btn" data-testid="select-edition">Choose</button>
            </form>
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
{:else if view.kind === 'no-editions'}
  <!-- Defensive: the projection always carries candidates in this phase; if a stale or drifted
       reader ever sees none, say so instead of presenting a silent dead end. -->
  <p data-testid="no-candidates">
    This acquisition is waiting for an edition selection, but no candidate editions are available.
    Cancel and resubmit the request.
  </p>
{/if}

{#if isCancellable(acquisition)}
  <form method="POST" action="?/cancel">
    <button type="submit" class="btn" data-testid="cancel">Cancel</button>
  </form>
{/if}

<h2>History</h2>
{#if refreshFailed}
  <p class="refresh-warning" role="status" data-testid="refresh-failed">
    Couldn’t refresh just now — retrying.
  </p>
{/if}
{#if importSection.state === 'unavailable'}
  <p data-testid="import-unavailable">
    The import side of this acquisition is momentarily unavailable.
  </p>
{/if}
{#if rows.length === 0 && pending === undefined}
  <!-- Defensive only: a real acquisition always has at least its requested entry. -->
  <p data-testid="no-history">
    No history recorded yet — this page updates as the acquisition progresses.
  </p>
{:else}
  <ol class="timeline" data-testid="history">
    {#each rows as row, index (index)}
      {#if row.divider !== undefined}
        <!-- role=presentation: a divider is chrome, not one of the history's items, so assistive
             tech should not count it in the list. -->
        <li class="timeline-date" role="presentation" data-testid="date-divider">{row.divider}</li>
      {/if}
      <li class="timeline-entry" data-module={row.item.module} data-state={row.copy.state}>
        <span class="timeline-marker" aria-hidden="true"></span>
        <div class="timeline-body">
          <span class="timeline-text">{row.copy.text}</span>
          {#if row.duration !== undefined}
            <span class="timeline-duration" data-testid="duration">· {row.duration}</span>
          {/if}
          {#if row.copy.link}
            <a class="timeline-link" href={row.copy.link.href}>{row.copy.link.label}</a>
          {/if}
          {#if row.copy.detail.length > 0}
            <details class="timeline-detail">
              <summary>Details</summary>
              <dl>
                {#each row.copy.detail as detailItem, detailIndex (detailIndex)}
                  <dt>{detailItem.label}</dt>
                  <dd>{detailItem.value}</dd>
                {/each}
              </dl>
            </details>
          {/if}
        </div>
        <time datetime={row.item.at} title={fullTime(row.item.at, timeZone)}>
          {entryTime(row.item.at, nowIso, timeZone)}
        </time>
      </li>
    {/each}
    {#if pending}
      <li
        class="timeline-entry timeline-pending"
        data-state={pending.state}
        data-testid="pending-row"
      >
        <span class="timeline-marker" aria-hidden="true"></span>
        <div class="timeline-body">
          <span class="timeline-text">{pending.text}</span>
          {#if pending.link}
            <a class="timeline-link" href={pending.link.href}>{pending.link.label}</a>
          {/if}
          {#if pending.showProgress}
            {#if progress}
              <ProgressBar {progress} />
            {:else if progressUnavailable}
              <span data-testid="progress-unavailable">
                This download is in progress, but its live progress is momentarily unavailable.
              </span>
            {/if}
          {/if}
        </div>
        <time datetime={nowIso}>now</time>
      </li>
    {/if}
  </ol>
{/if}

<p><a href="/acquisitions">Back to acquisitions</a></p>

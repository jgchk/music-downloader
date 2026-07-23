<script lang="ts">
  import type { PendingReviewDto } from '@music/importer';
  import { contextSummary, hintNote, kindLabel } from '$lib/reviews.js';
  import CandidateTable from './CandidateTable.svelte';
  import ManualTagsForm from './ManualTagsForm.svelte';
  import ResolveForms from './ResolveForms.svelte';

  interface Properties {
    pending: PendingReviewDto;
    /** Resolve-action failure to surface (incl. the stale-resolution conflict). */
    error?: string;
  }

  let { pending, error }: Properties = $props();
  const review = $derived(pending.review);
</script>

<h1>{pending.path}</h1>
<p>
  <span class="chip" data-kind={review.kind}>{kindLabel(review.kind)}</span>
  <span data-testid="context">{contextSummary(pending)}</span>
</p>

{#if error}
  <p class="error" role="alert" data-testid="action-error">{error}</p>
{/if}

{#if review.kind === 'match-review'}
  {@const note = hintNote(review)}
  {#if note}
    <p data-testid="hinted">Your hint: {note}.</p>
  {/if}
  <CandidateTable candidates={review.candidates} />
  <ResolveForms supplyId refresh importAsIs reject rejectUnusable />
  <ManualTagsForm />
{:else if review.kind === 'no-match'}
  <p data-testid="no-match-note">
    Beets found no candidates for this directory — this release may not exist in MusicBrainz.
  </p>
  <ResolveForms supplyId refresh importAsIs reject rejectUnusable />
  <ManualTagsForm />
{:else if review.kind === 'duplicate-review'}
  <h2>Already in the library</h2>
  <ul data-testid="incumbents">
    {#each review.incumbents as incumbent (incumbent.path)}
      <li>{incumbent.artist} — {incumbent.album} ({incumbent.path})</li>
    {/each}
  </ul>
  <CandidateTable candidates={review.candidates} withDuplicateAction />
  <ResolveForms reject rejectUnusable />
{:else if review.kind === 'remediation-review'}
  <h2>The import applied, but enrichment failed</h2>
  <ul data-testid="failures">
    {#each review.failures as failure (failure.stage)}
      <li>{failure.stage}: {failure.message}</li>
    {/each}
  </ul>
  <ResolveForms accept retryEnrichment />
{:else}
  <!-- Tolerant reader: a review kind the importer adds later lands here rather than mislabeling as
       remediation-review and dereferencing a `failures` field it may not carry. -->
  <p data-testid="unknown-review">This review needs attention, but its type is unrecognized.</p>
{/if}

<p><a href="/reviews">Back to reviews</a></p>

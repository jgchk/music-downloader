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
  // Which verbs to offer is the importer's decided set, rendered — never re-derived per kind here.
  // Absent (an older producer) degrades to no actions rather than falling back to a hardcoded list.
  const actions = $derived(new Set(pending.availableActions));
</script>

<h1>{pending.path}</h1>
<p>
  <span class="chip" data-kind={review.kind}>{kindLabel(review.kind)}</span>
  <span data-testid="context">{contextSummary(pending)}</span>
</p>

{#if error}
  <p class="error" role="alert" data-testid="action-error">{error}</p>
{/if}

<!-- The kind-specific *evidence* (hint, candidate table, incumbents, failures) stays keyed on the
     review kind — it is presentation. The *action affordances* below come from `availableActions`. -->
{#if review.kind === 'match-review'}
  {@const note = hintNote(review)}
  {#if note}
    <p data-testid="hinted">Your hint: {note}.</p>
  {/if}
  <CandidateTable candidates={review.candidates} canApply={actions.has('apply-candidate')} />
{:else if review.kind === 'no-match'}
  <p data-testid="no-match-note">
    Beets found no candidates for this directory — this release may not exist in MusicBrainz.
  </p>
{:else if review.kind === 'duplicate-review'}
  <h2>Already in the library</h2>
  <ul data-testid="incumbents">
    {#each review.incumbents as incumbent (incumbent.path)}
      <li>{incumbent.artist} — {incumbent.album} ({incumbent.path})</li>
    {/each}
  </ul>
  <!-- The replace/keep-both duplicate-action parameter stays keyed on the kind — it is how a
       permitted apply verb is presented, analogous to badge colour. -->
  <CandidateTable
    candidates={review.candidates}
    canApply={actions.has('apply-candidate')}
    withDuplicateAction
  />
{:else if review.kind === 'remediation-review'}
  <h2>The import applied, but enrichment failed</h2>
  <ul data-testid="failures">
    {#each review.failures as failure (failure.stage)}
      <li>{failure.stage}: {failure.message}</li>
    {/each}
  </ul>
{:else}
  <!-- Tolerant reader: a review kind the importer adds later lands here rather than mislabeling as
       remediation-review and dereferencing a `failures` field it may not carry. -->
  <p data-testid="unknown-review">This review needs attention, but its type is unrecognized.</p>
{/if}

<ResolveForms
  supplyId={actions.has('supply-id')}
  refresh={actions.has('refresh-candidates')}
  importAsIs={actions.has('import-as-is')}
  reject={actions.has('reject')}
  rejectUnusable={actions.has('reject-unusable-delivery')}
  accept={actions.has('accept')}
  retryEnrichment={actions.has('retry-enrichment')}
/>
{#if actions.has('manual-tags')}
  <ManualTagsForm />
{/if}

<p><a href="/reviews">Back to reviews</a></p>

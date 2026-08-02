<script lang="ts" module>
  /** The pending destructive resolution awaiting its in-page confirmation (design D5). */
  export interface ConfirmState {
    verb: 'reject' | 'reject-unusable-delivery';
    reason?: string;
    reasons?: string;
  }
</script>

<script lang="ts">
  import type { PendingReviewDto } from '@music/importer';
  import { contextSummary, hintNote, kindLabel, stageGloss } from '$lib/reviews.js';
  import CandidateTable from './CandidateTable.svelte';
  import ManualTagsForm from './ManualTagsForm.svelte';
  import ResolveForms from './ResolveForms.svelte';

  interface Properties {
    pending: PendingReviewDto;
    /** The composed display title — musical intent first (design D3). */
    title: string;
    /** Resolve-action failure to surface (incl. the stale-resolution conflict). */
    error?: string;
    /** When set, the action forms yield to the confirmation step. */
    confirm?: ConfirmState;
  }

  let { pending, title, error, confirm }: Properties = $props();
  const review = $derived(pending.review);
  // Which verbs to offer is the importer's decided set, rendered — never re-derived per kind here.
  // Absent (an older producer) degrades to no actions rather than falling back to a hardcoded list.
  const actions = $derived(new Set(pending.availableActions));
</script>

<h1>{title}</h1>
<p class="path-line" data-testid="staged-path">Files: <span class="path">{pending.path}</span></p>
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
  <CandidateTable
    candidates={review.candidates}
    canApply={confirm === undefined && actions.has('apply-candidate')}
  />
{:else if review.kind === 'no-match'}
  <p data-testid="no-match-note">
    No release matched these files in any connected source — it may not exist there yet. Supply a
    release ID to point the search at it.
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
    canApply={confirm === undefined && actions.has('apply-candidate')}
    withDuplicateAction
  />
{:else if review.kind === 'remediation-review'}
  <h2>Added to the library, but some finishing steps failed</h2>
  <ul data-testid="failures">
    {#each review.failures as failure (failure.stage)}
      <li>{stageGloss(failure.stage)}: {failure.message}</li>
    {/each}
  </ul>
{:else}
  <!-- Tolerant reader: a review kind the importer adds later lands here rather than mislabeling as
       remediation-review and dereferencing a `failures` field it may not carry. -->
  <p data-testid="unknown-review">This needs your attention, but this page can’t describe it yet</p>
  <details class="review-detail-disclosure">
    <summary>Diagnostic detail</summary>
    <dl>
      <div>
        <dt>Review kind</dt>
        <dd>{(review as { kind: string }).kind}</dd>
      </div>
    </dl>
  </details>
{/if}

{#if confirm !== undefined}
  <!-- The in-page confirmation (design D5): the specific consequence restated with the composed
       contract, and exactly two outcome-named choices. No dialog, no scripting. -->
  <section class="confirm-destructive" data-testid="confirm-destructive" aria-live="polite">
    <p>
      This deletes the downloaded files. {confirm.verb === 'reject'
        ? 'Nothing more will be tried — request the release again for another attempt.'
        : 'The search for a replacement continues.'}
    </p>
    <div class="confirm-choices">
      <form method="POST" action="?/resolve">
        <input type="hidden" name="verb" value={confirm.verb} />
        <input type="hidden" name="confirmed" value="true" />
        {#if confirm.reason !== undefined}
          <input type="hidden" name="reason" value={confirm.reason} />
        {/if}
        {#if confirm.reasons !== undefined}
          <input type="hidden" name="reasons" value={confirm.reasons} />
        {/if}
        <button type="submit" class="danger" data-testid="confirm-delete">Delete the files</button>
      </form>
      <a class="btn" href={`/reviews/${pending.importId}`} data-testid="confirm-keep">
        Keep the files
      </a>
    </div>
  </section>
{:else}
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
{/if}

<p><a href="/reviews">Back to reviews</a></p>

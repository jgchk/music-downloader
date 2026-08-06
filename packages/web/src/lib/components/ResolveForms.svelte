<script lang="ts">
  import { actionButtonText, type ResolutionVerb } from '$lib/resolution-actions.js';

  interface Properties {
    /** The importer's decided verb set, passed through — membership is never re-derived here. */
    actions: ReadonlySet<string>;
  }

  let { actions }: Properties = $props();

  // Compile totality over the verb inventory's union: a new importer verb fails the build here
  // until it is given a rendering home — either a form below, or one of the two components named
  // for the verbs this one deliberately does not render.
  const VERB_HOME = {
    'supply-id': 'form below',
    'refresh-candidates': 'form below',
    'import-as-is': 'form below',
    accept: 'form below',
    'retry-enrichment': 'form below',
    reject: 'form below',
    'reject-unusable-delivery': 'form below',
    'apply-candidate': 'CandidateTable',
    'manual-tags': 'ManualTagsForm',
  } as const satisfies Record<ResolutionVerb, string>;

  const isOffered = (verb: keyof typeof VERB_HOME): boolean => actions.has(verb);
</script>

<!-- Labels come from the verb inventory (reviews-register-alignment D1): imperative fragments, em-dash consequences
     stating the composed contract, no parenthesized asides. The two file-deleting verbs render
     low-emphasis danger — visible up front, confirmed in-page after submit (reviews-register-alignment D5). -->

{#if isOffered('supply-id')}
  <details data-testid="supply-id">
    <summary>Supply a release ID…</summary>
    <form method="POST" action="?/resolve">
      <input type="hidden" name="verb" value="supply-id" />
      <label>
        Release ID
        <input name="mbReleaseId" required placeholder="from any connected source" />
      </label>
      <button type="submit">{actionButtonText('supply-id')}</button>
    </form>
  </details>
{/if}

{#if isOffered('refresh-candidates')}
  <form method="POST" action="?/resolve" data-testid="refresh">
    <input type="hidden" name="verb" value="refresh-candidates" />
    <button type="submit">{actionButtonText('refresh-candidates')}</button>
  </form>
{/if}

{#if isOffered('import-as-is')}
  <form method="POST" action="?/resolve" data-testid="import-as-is">
    <input type="hidden" name="verb" value="import-as-is" />
    <button type="submit">{actionButtonText('import-as-is')}</button>
  </form>
{/if}

{#if isOffered('accept')}
  <form method="POST" action="?/resolve" data-testid="accept">
    <input type="hidden" name="verb" value="accept" />
    <button type="submit">{actionButtonText('accept')}</button>
  </form>
{/if}

{#if isOffered('retry-enrichment')}
  <form method="POST" action="?/resolve" data-testid="retry-enrichment">
    <input type="hidden" name="verb" value="retry-enrichment" />
    <button type="submit">{actionButtonText('retry-enrichment')}</button>
  </form>
{/if}

{#if isOffered('reject')}
  <form method="POST" action="?/resolve" data-testid="reject">
    <input type="hidden" name="verb" value="reject" />
    <label>Reason (optional) <input name="reason" /></label>
    <button type="submit" class="danger">{actionButtonText('reject')}</button>
  </form>
{/if}

{#if isOffered('reject-unusable-delivery')}
  <form method="POST" action="?/resolve" data-testid="reject-unusable">
    <input type="hidden" name="verb" value="reject-unusable-delivery" />
    <label>
      Reasons (one per line)
      <textarea name="reasons"></textarea>
    </label>
    <button type="submit" class="danger">{actionButtonText('reject-unusable-delivery')}</button>
  </form>
{/if}

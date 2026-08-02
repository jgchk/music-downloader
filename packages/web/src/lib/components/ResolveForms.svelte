<script lang="ts">
  import { actionButtonText } from '$lib/resolution-actions.js';

  interface Properties {
    supplyId?: boolean;
    refresh?: boolean;
    importAsIs?: boolean;
    reject?: boolean;
    rejectUnusable?: boolean;
    accept?: boolean;
    retryEnrichment?: boolean;
  }

  let {
    supplyId = false,
    refresh = false,
    importAsIs = false,
    reject = false,
    rejectUnusable = false,
    accept = false,
    retryEnrichment = false,
  }: Properties = $props();
</script>

<!-- Labels come from the verb inventory (reviews-register-alignment D1): imperative fragments, em-dash consequences
     stating the composed contract, no parenthesized asides. The two file-deleting verbs render
     low-emphasis danger — visible up front, confirmed in-page after submit (reviews-register-alignment D5). -->

{#if supplyId}
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

{#if refresh}
  <form method="POST" action="?/resolve" data-testid="refresh">
    <input type="hidden" name="verb" value="refresh-candidates" />
    <button type="submit">{actionButtonText('refresh-candidates')}</button>
  </form>
{/if}

{#if importAsIs}
  <form method="POST" action="?/resolve" data-testid="import-as-is">
    <input type="hidden" name="verb" value="import-as-is" />
    <button type="submit">{actionButtonText('import-as-is')}</button>
  </form>
{/if}

{#if accept}
  <form method="POST" action="?/resolve" data-testid="accept">
    <input type="hidden" name="verb" value="accept" />
    <button type="submit">{actionButtonText('accept')}</button>
  </form>
{/if}

{#if retryEnrichment}
  <form method="POST" action="?/resolve" data-testid="retry-enrichment">
    <input type="hidden" name="verb" value="retry-enrichment" />
    <button type="submit">{actionButtonText('retry-enrichment')}</button>
  </form>
{/if}

{#if reject}
  <form method="POST" action="?/resolve" data-testid="reject">
    <input type="hidden" name="verb" value="reject" />
    <label>Reason (optional) <input name="reason" /></label>
    <button type="submit" class="danger">{actionButtonText('reject')}</button>
  </form>
{/if}

{#if rejectUnusable}
  <form method="POST" action="?/resolve" data-testid="reject-unusable">
    <input type="hidden" name="verb" value="reject-unusable-delivery" />
    <label>
      Reasons (one per line)
      <textarea name="reasons"></textarea>
    </label>
    <button type="submit" class="danger">{actionButtonText('reject-unusable-delivery')}</button>
  </form>
{/if}

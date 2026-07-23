<script lang="ts">
  interface Properties {
    supplyId?: boolean;
    refresh?: boolean;
    importAsIs?: boolean;
    reject?: boolean;
    rejectAndRetry?: boolean;
    accept?: boolean;
    retryEnrichment?: boolean;
  }

  let {
    supplyId = false,
    refresh = false,
    importAsIs = false,
    reject = false,
    rejectAndRetry = false,
    accept = false,
    retryEnrichment = false,
  }: Properties = $props();
</script>

{#if supplyId}
  <form method="POST" action="?/resolve" data-testid="supply-id">
    <input type="hidden" name="verb" value="supply-id" />
    <label>
      Release ID
      <input name="mbReleaseId" required placeholder="any source beets can resolve" />
    </label>
    <button type="submit">Re-propose with this release</button>
  </form>
{/if}

{#if refresh}
  <form method="POST" action="?/resolve" data-testid="refresh">
    <input type="hidden" name="verb" value="refresh-candidates" />
    <button type="submit">Refresh candidates</button>
  </form>
{/if}

{#if importAsIs}
  <form method="POST" action="?/resolve" data-testid="import-as-is">
    <input type="hidden" name="verb" value="import-as-is" />
    <button type="submit">Import as-is (keep current tags)</button>
  </form>
{/if}

{#if accept}
  <form method="POST" action="?/resolve" data-testid="accept">
    <input type="hidden" name="verb" value="accept" />
    <button type="submit">Accept as imported</button>
  </form>
{/if}

{#if retryEnrichment}
  <form method="POST" action="?/resolve" data-testid="retry-enrichment">
    <input type="hidden" name="verb" value="retry-enrichment" />
    <button type="submit">Retry the failed step</button>
  </form>
{/if}

{#if reject}
  <form method="POST" action="?/resolve" data-testid="reject">
    <input type="hidden" name="verb" value="reject" />
    <label>Reason (optional) <input name="reason" /></label>
    <button type="submit">Reject (delete files)</button>
  </form>
{/if}

{#if rejectAndRetry}
  <form method="POST" action="?/resolve" data-testid="reject-retry">
    <input type="hidden" name="verb" value="reject-and-retry-download" />
    <label>
      Reasons (one per line)
      <textarea name="reasons"></textarea>
    </label>
    <button type="submit">Reject and retry the download</button>
  </form>
{/if}

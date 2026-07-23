<script lang="ts">
  import { page } from '$app/state';
</script>

<h1>Something went wrong</h1>
<p data-testid="error-message">{page.error?.message}</p>
{#if page.error?.errorId}
  <p data-testid="error-id">Error id: <code>{page.error.errorId}</code></p>
{/if}
<p><a href="/">Back to home</a></p>

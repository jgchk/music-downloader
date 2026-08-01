<script lang="ts">
  import type { PageProps as PageProperties } from './$types';

  let { data, form }: PageProperties = $props();

  const error = $derived(form?.error ?? data.error);
</script>

<svelte:head>
  <title>Sign in — music</title>
</svelte:head>

<article class="panel login" data-testid="login">
  <h1>Sign in</h1>
  <p>
    This library's downloader is for invited listeners: sign in with the Plex account this server is
    shared with.
  </p>
  {#if error !== undefined}
    <p class="error" role="alert" data-testid="login-error">{error}</p>
  {/if}
  <form method="POST">
    <button class="btn primary" data-testid="plex-login">Sign in with Plex</button>
  </form>
</article>

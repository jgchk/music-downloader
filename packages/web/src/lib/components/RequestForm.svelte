<script lang="ts">
  import { enhance } from '$app/forms';
  import RequestedNotice from './RequestedNotice.svelte';
  import type { Snippet } from 'svelte';

  interface Properties {
    /** What to request, as the submit contract's own field names. */
    fields: Record<string, string>;
    /** What to call it back — the page had this on screen, so the answer need not re-read it. */
    title?: string | undefined;
    /** The button's words at rest. */
    label?: string;
    /** Anything the form carries above its button — the detail view's quality policies. */
    children?: Snippet;
  }

  let { fields, title, label = 'Request', children }: Properties = $props();

  /**
   * This form's own state, not the page's. A single counter shared across every result made one
   * request disable all twenty-five of them, and put one confirmation wherever the page decided —
   * neither of which is true of the thing that happened.
   */
  let busy = $state(false);
  let requested = $state<{ acquisitionId: string; title?: string } | undefined>();
</script>

<form
  method="POST"
  action="?/request"
  class="request-form"
  use:enhance={() => {
    busy = true;
    return async ({ result, update }) => {
      const answered = result.type === 'success' ? result.data?.['requested'] : undefined;
      if (answered !== undefined) {
        busy = false;
        // Deliberately no `update()`: applying the action's result would re-run the page's load
        // and throw away the query, its results, and whatever was open — which is the entire
        // thing this action exists to avoid.
        requested = answered as { acquisitionId: string; title?: string };
        return;
      }
      await update({ reset: false });
      busy = false;
    };
  }}
>
  {#each Object.entries(fields) as [name, value] (name)}
    <input type="hidden" {name} {value} />
  {/each}
  {#if title !== undefined}
    <input type="hidden" name="title" value={title} />
  {/if}
  {@render children?.()}
  <!-- Where this form sits is the stylesheet's business, not a class each caller passes: one
       button, said once, which is also what lets a scan of the markup read its kind. -->
  <button type="submit" class="btn primary" disabled={busy}>
    {busy ? 'Requesting…' : label}
  </button>
  <RequestedNotice {requested} />
</form>

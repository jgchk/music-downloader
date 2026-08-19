<script lang="ts">
  import { z } from 'zod';
  import { enhance } from '$app/forms';
  import RequestRefusal from './RequestRefusal.svelte';
  import RequestedNotice from './RequestedNotice.svelte';
  import type { Snippet } from 'svelte';

  /**
   * What the request action answers with. Parsed rather than asserted, for the same reason the
   * catalog client parses its reads: this crossed a wire, and a shape that drifted would reach a
   * person as a confirmation linking to `/acquisitions/undefined`.
   */
  const requestedSchema = z.object({
    acquisitionId: z.string().min(1),
    title: z.string().optional(),
  });

  /** The words a refusal arrives with, so this form can say them where it happened. */
  const refusalSchema = z.object({ message: z.string() });

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
   * This form's own state, not the page's. Before, a single counter shared across every result
   * meant one request in flight disabled every other result's button — and a request that
   * SUCCEEDED navigated away from the search entirely, which is the thing this replaces.
   */
  let busy = $state(false);
  let requested = $state<{ acquisitionId: string; title?: string } | undefined>();
  /**
   * Why this form's own submission was refused. Beside the button that was pressed, because the
   * page-level banner sits at the top of a scrolled grid — or behind the detail view entirely —
   * and a refusal nobody can see is indistinguishable from a click that did not register.
   */
  let refused = $state<string | undefined>();
</script>

<form
  method="POST"
  action="?/request"
  class="request-form"
  use:enhance={() => {
    busy = true;
    requested = undefined;
    refused = undefined;
    return async ({ result }) => {
      try {
        const answered =
          result.type === 'success'
            ? requestedSchema.safeParse(result.data?.['requested'])
            : undefined;
        if (answered?.success === true) {
          // Deliberately no `update()`: it would invalidate the page's load for nothing, replace
          // the page-level form state this request has no business touching, and move the cursor
          // back to the top of the document — none of which belongs to asking for one record.
          requested = answered.data;
          return;
        }
        const said = result.type === 'failure' ? refusalSchema.safeParse(result.data) : undefined;
        // The action's own words when it gave any; otherwise the fact that it did not land.
        refused =
          said?.success === true
            ? said.data.message
            : 'That request did not go through. Try again.';
      } finally {
        // In a `finally` because a stuck "Requesting…" that never comes back is the least
        // debuggable way for a bug here to surface, and the button is the only way out.
        busy = false;
      }
    };
  }}
>
  {#each Object.entries(fields) as [name, value] (name)}
    <input type="hidden" {name} {value} />
  {/each}
  {#if title !== undefined}
    <!-- NOT `title`: that name belongs to the submit contract's descriptor request, and echoing a
         display string into it would put an album's name in the artist-and-title form the next
         time a request was refused. -->
    <input type="hidden" name="displayTitle" value={title} />
  {/if}
  {@render children?.()}
  <!-- Where this form sits is the stylesheet's business, not a class each caller passes: one
       button, said once, which is also what lets a scan of the markup read its kind. -->
  <button type="submit" class="btn primary" disabled={busy}>
    {busy ? 'Requesting…' : label}
  </button>
  <RequestedNotice {requested} />
  <RequestRefusal {refused} />
</form>

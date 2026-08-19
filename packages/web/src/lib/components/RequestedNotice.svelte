<script lang="ts">
  interface Properties {
    /** The download that was made, or nothing when none has been yet. */
    requested?: { readonly acquisitionId: string; readonly title?: string } | undefined;
  }

  let { requested }: Properties = $props();

  /**
   * What was asked for, said back. The action returns the title for exactly this: a wall of
   * identical "Requested" lines down a page of results says which button was pressed only by
   * where it sits, and that is not enough to check by.
   */
  const said = $derived(
    requested?.title === undefined ? 'Requested' : `Requested ${requested.title}`,
  );
</script>

{#if requested !== undefined}
  <!-- At the form that submitted it: five requests from one search leave five confirmations, each
       beside the record it is about. Its own component so both rendering tiers can exercise it —
       a browser-only branch inside a server-rendered form is one no test can reach twice. -->
  <p class="requested" role="status">
    <span>{said}</span>
    <a href={`/acquisitions/${requested.acquisitionId}`}>open it</a>
  </p>
{/if}

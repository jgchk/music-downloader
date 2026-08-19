<script lang="ts">
  interface Properties {
    /** The download that was made, or nothing when none has been yet. */
    requested?: { readonly acquisitionId: string } | undefined;
  }

  let { requested }: Properties = $props();
</script>

{#if requested !== undefined}
  <!-- At the form that submitted it: five requests from one search leave five confirmations, each
       beside the record it is about. Its own component so both rendering tiers can exercise it —
       a browser-only branch inside a server-rendered form is one no test can reach twice. -->
  <p class="requested" role="status">
    <span>Requested</span>
    <a href={`/acquisitions/${requested.acquisitionId}`}>open it</a>
  </p>
{/if}

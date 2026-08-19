<script lang="ts">
  interface Properties {
    /** Why this form's own submission was refused, or nothing while it has not been. */
    refused?: string | undefined;
  }

  let { refused }: Properties = $props();
</script>

{#if refused !== undefined}
  <!-- Beside the button that was pressed. The page-level banner sits at the top of a scrolled
       grid, or behind the detail view entirely, and a refusal nobody sees is indistinguishable
       from a click that did not register — so the next thing that happens is a second click.
       Its own component so both rendering tiers can exercise it, as with the confirmation. -->
  <p class="error" role="alert">{refused}</p>
{/if}

<script lang="ts">
  import { phaseLabel, type BadgePhase } from '$lib/phase-label.js';

  interface Props {
    phase: BadgePhase;
    reasons?: readonly string[];
    /** Server-renderable initial expansion — the BFF may deep-link straight to open reasons. */
    initiallyExpanded?: boolean;
  }

  let { phase, reasons = [], initiallyExpanded = false }: Props = $props();
  // The prop is deliberately an initial value only (server-renderable initial expansion).
  // svelte-ignore state_referenced_locally
  let expanded = $state(initiallyExpanded);

  const label = $derived(phaseLabel(phase));

  function toggle(): void {
    expanded = !expanded;
  }
</script>

<span class="badge" data-phase={phase}>{label}</span>
{#if phase === 'failed'}
  <button type="button" onclick={toggle}>{expanded ? 'Hide' : 'Show'} reasons</button>
  {#if expanded}
    <ul>
      {#each reasons as reason (reason)}
        <li>{reason}</li>
      {:else}
        <li>No reasons given</li>
      {/each}
    </ul>
  {/if}
{/if}

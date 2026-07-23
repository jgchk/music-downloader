<script lang="ts">
  import { phaseLabel, type BadgePhase } from '$lib/phase-label.js';

  interface Properties {
    phase: BadgePhase;
  }

  let { phase }: Properties = $props();

  const label = $derived(phaseLabel(phase));
</script>

<span class="badge" data-phase={phase}>{label}</span>

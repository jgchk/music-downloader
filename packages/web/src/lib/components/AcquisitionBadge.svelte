<script lang="ts">
  import { phaseLabel, type BadgePhase } from '$lib/phase-label.js';

  interface Props {
    phase: BadgePhase;
  }

  let { phase }: Props = $props();

  const label = $derived(phaseLabel(phase));
</script>

<span class="badge" data-phase={phase}>{label}</span>

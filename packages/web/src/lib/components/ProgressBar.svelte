<script lang="ts">
  import type { ProgressResponseDto } from '@music/downloader';
  import { formatBytes } from '$lib/acquisitions.js';

  interface Properties {
    progress: ProgressResponseDto;
  }

  let { progress }: Properties = $props();
  const percent = $derived(Math.round(progress.percent));
</script>

<div data-testid="progress">
  <progress max="100" value={percent}></progress>
  <span>
    {percent}% — {formatBytes(progress.bytesTransferred)} of {formatBytes(progress.bytesTotal)}
    {#if progress.queuePosition !== undefined}
      (queue position {progress.queuePosition})
    {/if}
  </span>
</div>

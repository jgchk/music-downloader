<script lang="ts">
  import type { ProgressResponseDto } from '@music/downloader';
  import { formatBytes } from '$lib/acquisitions.js';

  interface Props {
    progress: ProgressResponseDto;
  }

  let { progress }: Props = $props();
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

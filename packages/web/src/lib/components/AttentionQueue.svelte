<script lang="ts">
  import { attentionKindLabel, moduleLabel, type AttentionItem } from '$lib/attention.js';

  interface Properties {
    items: readonly AttentionItem[];
    /** Per-section modeled failures — a failed module hides its items, so no empty claim then. */
    errors?: Partial<Record<AttentionItem['module'], string>>;
  }

  let { items, errors = {} }: Properties = $props();

  const anySectionFailed = $derived(Object.values(errors).some((message) => message !== undefined));
</script>

{#if errors.importer !== undefined}
  <p class="error" role="alert" data-testid="section-error-importer">{errors.importer}</p>
{/if}
{#if errors.downloader !== undefined}
  <p class="error" role="alert" data-testid="section-error-downloader">{errors.downloader}</p>
{/if}

{#if items.length === 0}
  {#if !anySectionFailed}
    <p data-testid="empty">Nothing needs your attention.</p>
  {/if}
{:else}
  <ul>
    {#each items as item (`${item.module}:${item.id}`)}
      <li data-testid="attention-row">
        <a href={item.href}>{item.title}</a>
        <span class="chip" data-module={item.module}>{moduleLabel(item.module)}</span>
        <span class="chip" data-kind={item.kind}>{attentionKindLabel(item.kind)}</span>
        {#if item.waitingSince !== undefined}
          <span data-testid="waiting-since">waiting since {item.waitingSince}</span>
        {/if}
      </li>
    {/each}
  </ul>
{/if}

<script lang="ts">
  interface Row {
    path: string;
    title: string;
    artist: string;
    trackNumber: string;
    discNumber: string;
  }

  const emptyRow = (): Row => ({
    path: '',
    title: '',
    artist: '',
    trackNumber: '',
    discNumber: '',
  });

  interface Props {
    /** Server-renderable initial rows (spike rule: initial UI state is prop-drivable). */
    initialRows?: Row[];
  }

  let { initialRows = [emptyRow()] }: Props = $props();
  // The prop is deliberately an initial value only.
  // svelte-ignore state_referenced_locally
  let rows = $state<Row[]>(initialRows);

  function addRow(): void {
    rows.push(emptyRow());
  }

  function removeRow(index: number): void {
    rows.splice(index, 1);
  }
</script>

<details data-testid="manual-tags">
  <summary>Import with manual tags</summary>
  <form method="POST" action="?/resolve">
    <input type="hidden" name="verb" value="manual-tags" />
    <label>Album artist <input name="albumArtist" required /></label>
    <label>Album <input name="album" required /></label>
    <label>Year <input name="year" inputmode="numeric" /></label>

    {#each rows as row, i (i)}
      <fieldset data-testid="track-row">
        <legend>Track {i + 1}</legend>
        <label>File path <input name={`tracks.${i}.path`} bind:value={row.path} required /></label>
        <label>Title <input name={`tracks.${i}.title`} bind:value={row.title} required /></label>
        <label
          >Artist (optional) <input name={`tracks.${i}.artist`} bind:value={row.artist} /></label
        >
        <label>
          Track #
          <input
            name={`tracks.${i}.trackNumber`}
            inputmode="numeric"
            bind:value={row.trackNumber}
            required
          />
        </label>
        <label>
          Disc # (optional)
          <input name={`tracks.${i}.discNumber`} inputmode="numeric" bind:value={row.discNumber} />
        </label>
        {#if rows.length > 1}
          <button type="button" data-testid="remove-track" onclick={() => removeRow(i)}>
            Remove track
          </button>
        {/if}
      </fieldset>
    {/each}

    <button type="button" data-testid="add-track" onclick={addRow}>Add track</button>
    <button type="submit">Import with these tags</button>
  </form>
</details>

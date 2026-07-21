<script lang="ts">
  import type { ReviewDto } from '@music/importer';
  import { formatDistance } from '$lib/reviews.js';

  type Candidate = Extract<ReviewDto, { kind: 'match-review' }>['candidates'][number];

  interface Props {
    candidates: readonly Candidate[];
    /** Offer a replace/keep-both choice on apply (duplicate reviews). */
    withDuplicateAction?: boolean;
  }

  let { candidates, withDuplicateAction = false }: Props = $props();
</script>

<table data-testid="candidates">
  <thead>
    <tr><th>Candidate</th><th>Distance</th><th>Penalties</th><th>Tracks</th><th></th></tr>
  </thead>
  <tbody>
    {#each candidates as candidate (candidate.ref.dataSource + candidate.ref.albumId)}
      <tr data-testid="candidate-row">
        <td>{candidate.artist} — {candidate.album}</td>
        <td>{formatDistance(candidate.distance)}</td>
        <td>
          {#each candidate.penalties as penalty (penalty.name)}
            <span class="chip">{penalty.name} {formatDistance(penalty.amount)}</span>
          {:else}
            <span>none</span>
          {/each}
        </td>
        <td>{candidate.tracks.length}</td>
        <td>
          <form method="POST" action="?/resolve">
            <input type="hidden" name="verb" value="apply-candidate" />
            <input type="hidden" name="dataSource" value={candidate.ref.dataSource} />
            <input type="hidden" name="albumId" value={candidate.ref.albumId} />
            {#if withDuplicateAction}
              <select name="duplicateAction" data-testid="duplicate-action">
                <option value="replace">Replace existing</option>
                <option value="keep-both">Keep both</option>
              </select>
            {/if}
            <button type="submit" data-testid="apply">Apply</button>
          </form>
        </td>
      </tr>
    {/each}
  </tbody>
</table>

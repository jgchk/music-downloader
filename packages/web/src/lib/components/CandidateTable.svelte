<script lang="ts">
  import type { ReviewDto } from '@music/importer';
  import { albumFieldList, formatDistance, isRetag, penaltyLabel } from '$lib/reviews.js';

  type Candidate = Extract<ReviewDto, { kind: 'match-review' }>['candidates'][number];

  interface Properties {
    candidates: readonly Candidate[];
    /** Offer a replace/keep-both choice on apply (duplicate reviews). */
    withDuplicateAction?: boolean;
    /**
     * Render the per-row apply affordance. Gated by the caller from the review's decided
     * `availableActions` (whether `apply-candidate` is a permitted verb); defaults to shown.
     */
    canApply?: boolean;
  }

  let { candidates, withDuplicateAction = false, canApply = true }: Properties = $props();

  // Branchless: strip everything up to the last slash (a leaf path stays whole).
  const basename = (path: string): string => path.replace(/^.*\//u, '');
</script>

<ul data-testid="candidates" class="candidates">
  {#each candidates as candidate (candidate.ref.dataSource + candidate.ref.albumId)}
    <li data-testid="candidate-row" class="candidate">
      <header class="candidate-head">
        <strong>{candidate.artist} — {candidate.album}</strong>
        <span class="source">{candidate.ref.dataSource} · {candidate.ref.albumId}</span>
        <span class="distance">{formatDistance(candidate.distance)} off</span>
      </header>

      {#if candidate.albumFields}
        {@const albumRows = albumFieldList(candidate.albumFields)}
        {#if albumRows.length > 0}
          <dl data-testid="album-fields" class="album-fields">
            {#each albumRows as field (field.label)}
              <div>
                <dt>{field.label}</dt>
                <dd>{field.value}</dd>
              </div>
            {/each}
          </dl>
        {/if}
      {/if}

      {#if candidate.tracks.length > 0 || candidate.extraItems?.length || candidate.missingTracks?.length}
        <table data-testid="track-diff" class="track-diff">
          <thead>
            <tr><th>#</th><th>Your file</th><th>Candidate track</th><th></th></tr>
          </thead>
          <tbody>
            {#each candidate.tracks as track (track.path)}
              <tr>
                <td>{track.index}</td>
                <td>{track.current ? track.current.title : basename(track.path)}</td>
                <td>{track.title}</td>
                <td>
                  {#if isRetag(track)}<span data-testid="retag" class="tag retag">retag</span>{/if}
                </td>
              </tr>
            {/each}
            {#each candidate.extraItems ?? [] as extra (extra.path)}
              <tr data-testid="extra-item">
                <td>—</td>
                <td>{extra.title || basename(extra.path)}</td>
                <td class="muted">no matching track</td>
                <td><span class="tag extra">extra file</span></td>
              </tr>
            {/each}
            {#each candidate.missingTracks ?? [] as missing (missing.index)}
              <tr data-testid="missing-track">
                <td>{missing.index}</td>
                <td class="muted">no downloaded file</td>
                <td>{missing.title}</td>
                <td><span class="tag missing">missing</span></td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}

      <p class="penalties" data-testid="penalties">
        Why this score:
        {#each candidate.penalties as penalty (penalty.name)}
          <span class="chip">{penaltyLabel(penalty.name)} {formatDistance(penalty.amount)}</span>
        {:else}
          <span>clean match</span>
        {/each}
      </p>

      {#if canApply}
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
          <button type="submit" data-testid="apply">Apply this candidate</button>
        </form>
      {/if}
    </li>
  {/each}
</ul>

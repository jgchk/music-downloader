<script lang="ts">
  import type { ReviewDto } from '@music/importer';
  import { wordDiff } from '$lib/diff.js';
  import { actionButtonText } from '$lib/resolution-actions.js';
  import {
    albumFieldList,
    formatDistance,
    isRetag,
    matchQualityText,
    pathBasename,
    penaltyLabel,
  } from '$lib/reviews.js';

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
</script>

<ul data-testid="candidates" class="candidates">
  {#each candidates as candidate (candidate.ref.dataSource + candidate.ref.albumId)}
    <li data-testid="candidate-row" class="candidate">
      <header class="candidate-head">
        <strong>{candidate.artist} — {candidate.album}</strong>
        <!-- Coarse, higher-is-better (reviews-register-alignment D6); the raw score and identifiers live in the
             disclosure below, never in the headline. -->
        <span class="match-quality">{matchQualityText(candidate.distance)}</span>
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
            <!-- Direction is explicit in the column names: current → proposed (reviews-register-alignment D7). -->
            <tr><th>#</th><th>Currently tagged</th><th>Will become</th><th></th></tr>
          </thead>
          <tbody>
            {#each candidate.tracks as track (track.path)}
              {#if isRetag(track) && track.current}
                {@const diff = wordDiff(track.current.title, track.title)}
                <tr>
                  <td>{track.index}</td>
                  <td>
                    {#each diff.from as segment, index (index)}
                      {#if segment.changed}<mark>{segment.text}</mark>{:else}{segment.text}{/if}
                    {/each}
                  </td>
                  <td>
                    {#each diff.to as segment, index (index)}
                      {#if segment.changed}<mark>{segment.text}</mark>{:else}{segment.text}{/if}
                    {/each}
                  </td>
                  <td><span data-testid="retag" class="tag retag">retag</span></td>
                </tr>
              {:else}
                <!-- Unchanged rows stay visible as coverage evidence but de-emphasized so the
                     differences carry the eye; not-yet-tagged rows stay plain — gaining tags IS
                     a change (reviews-register-alignment D7). -->
                <tr class={track.current ? 'unchanged' : undefined}>
                  <td>{track.index}</td>
                  <td>{track.current ? track.current.title : pathBasename(track.path)}</td>
                  <td>{track.title}</td>
                  <td></td>
                </tr>
              {/if}
            {/each}
            {#each candidate.extraItems ?? [] as extra (extra.path)}
              <tr data-testid="extra-item">
                <td>—</td>
                <td>{extra.title || pathBasename(extra.path)}</td>
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

      <!-- Penalty reasons are decision evidence and stay visible; their amounts are diagnostics
           and live in the disclosure (reviews-register-alignment D6/D7). -->
      <p class="penalties" data-testid="penalties">
        Why this score:
        {#each candidate.penalties as penalty (penalty.name)}
          <span class="chip">{penaltyLabel(penalty.name)}</span>
        {:else}
          <span>no penalties recorded</span>
        {/each}
      </p>

      <details class="candidate-details" data-testid="matching-details">
        <summary>Matching details — source, release ID, raw score</summary>
        <dl>
          <div>
            <dt>Source</dt>
            <dd>{candidate.ref.dataSource}</dd>
          </div>
          <div>
            <dt>Release ID</dt>
            <dd>{candidate.ref.albumId}</dd>
          </div>
          <div>
            <dt>Raw distance</dt>
            <dd>{candidate.distance}</dd>
          </div>
          {#each candidate.penalties as penalty (penalty.name)}
            <div>
              <dt>{penaltyLabel(penalty.name)}</dt>
              <dd>{formatDistance(penalty.amount)}</dd>
            </div>
          {/each}
        </dl>
      </details>

      {#if canApply}
        <form method="POST" action="?/resolve">
          <input type="hidden" name="verb" value="apply-candidate" />
          <input type="hidden" name="dataSource" value={candidate.ref.dataSource} />
          <input type="hidden" name="albumId" value={candidate.ref.albumId} />
          {#if withDuplicateAction}
            <select name="duplicateAction" data-testid="duplicate-action">
              <option value="replace">Replace the existing copy</option>
              <option value="keep-both">Keep both copies</option>
            </select>
          {/if}
          <button type="submit" class="btn" data-testid="apply"
            >{actionButtonText('apply-candidate')}</button
          >
        </form>
      {/if}
    </li>
  {/each}
</ul>

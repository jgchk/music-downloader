<script lang="ts">
  import QualityFloorSelect from './QualityFloorSelect.svelte';

  /**
   * The policies a request may carry beyond its quality floor: how a candidate is judged, how long
   * the search may go on, and when a stalled transfer is given up on. Folded away because almost
   * nobody sets them — but present, because the request contract accepts them and a page that
   * silently could not express them would make the contract a lie.
   */
  interface Properties {
    /** What was submitted, echoed back so a rejected submission is corrected rather than retyped. */
    values?: Record<string, string | undefined>;
  }

  let { values }: Properties = $props();
</script>

<QualityFloorSelect />

<details class="request-policies">
  <summary>Advanced policies (optional)</summary>
  <label>
    Quality order (comma-separated buckets)
    <input name="qualityOrder" value={values?.qualityOrder ?? ''} />
  </label>
  <label>
    Match threshold (0–1)
    <input name="matchThreshold" inputmode="decimal" value={values?.matchThreshold ?? ''} />
  </label>
  <label>
    Max search rounds
    <input name="maxSearchRounds" inputmode="numeric" value={values?.maxSearchRounds ?? ''} />
  </label>
  <label>
    Max total attempts
    <input name="maxTotalAttempts" inputmode="numeric" value={values?.maxTotalAttempts ?? ''} />
  </label>
  <label>
    Time budget (ms)
    <input name="timeBudgetMs" inputmode="numeric" value={values?.timeBudgetMs ?? ''} />
  </label>
  <label>
    Stall timeout (ms)
    <input name="stallTimeoutMs" inputmode="numeric" value={values?.stallTimeoutMs ?? ''} />
  </label>
  <label>
    Max queue wait (ms)
    <input name="maxQueueWaitMs" inputmode="numeric" value={values?.maxQueueWaitMs ?? ''} />
  </label>
</details>

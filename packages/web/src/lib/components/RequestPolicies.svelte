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

<details>
  <summary>Advanced policies (optional)</summary>
  <label>
    Quality order (comma-separated, best first — e.g. LOSSLESS, LOSSY_HIGH)
    <input name="qualityOrder" value={values?.qualityOrder ?? ''} />
  </label>
  <!-- Typed and bounded where the contract is numeric: the reshaper turns anything unparseable
       into NaN, which comes back as a zod message after a round trip the field can prevent. -->
  <label>
    Match threshold (0–1)
    <input
      name="matchThreshold"
      type="number"
      min="0"
      max="1"
      step="0.01"
      value={values?.matchThreshold ?? ''}
    />
  </label>
  <label>
    Max search rounds
    <input
      name="maxSearchRounds"
      type="number"
      min="1"
      step="1"
      value={values?.maxSearchRounds ?? ''}
    />
  </label>
  <label>
    Max total attempts
    <input
      name="maxTotalAttempts"
      type="number"
      min="1"
      step="1"
      value={values?.maxTotalAttempts ?? ''}
    />
  </label>
  <label>
    Time budget (ms)
    <input
      name="timeBudgetMs"
      type="number"
      min="0"
      step="1000"
      value={values?.timeBudgetMs ?? ''}
    />
  </label>
  <label>
    Stall timeout (ms)
    <input
      name="stallTimeoutMs"
      type="number"
      min="0"
      step="1000"
      value={values?.stallTimeoutMs ?? ''}
    />
  </label>
  <label>
    Max queue wait (ms)
    <input
      name="maxQueueWaitMs"
      type="number"
      min="0"
      step="1000"
      value={values?.maxQueueWaitMs ?? ''}
    />
  </label>
</details>

<script lang="ts">
  // No props and no state: the floors are the request contract's own, written out below.
</script>

<!--
  The quality floor a request may raise, as the request contract names them.

  The options are written out rather than mapped over the floor table: the compiler's `<option>`
  helpers wrap an interpolated label in a nullish guard that no test can reach, and an unreachable
  branch is worse than a repeated word. Drift is caught by a test asserting these values are exactly
  the contract's own, which is the check that actually matters.
-->
<label>
  Quality floor
  <select name="qualityFloor">
    <option value="">Default</option>
    <option value="LOSSLESS_HIRES">Hi-res lossless</option>
    <option value="LOSSLESS">Lossless</option>
    <option value="LOSSY_HIGH">High quality lossy</option>
    <option value="LOSSY_STANDARD">Standard lossy</option>
    <option value="LOSSY_LOW">Low quality lossy</option>
    <option value="UNKNOWN">Unknown</option>
  </select>
</label>

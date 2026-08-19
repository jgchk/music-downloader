<script lang="ts">
  // No props and no state: the floors are the request contract's own, written out below.
</script>

<!--
  The quality floor a request may raise, as the request contract names them.

  The options are written out rather than mapped over `QUALITY_FLOORS`: the compiler compiles a
  mapped `<option {value}>` to `option.value = (option.__value = value()) ?? ''`, and that `?? ''`
  is a branch no test can reach. The values here are pinned against the contract's own keys by
  "offers every quality floor the request contract accepts, and no other" in
  `CatalogDetail.svelte.test.ts`; the LABELS are duplicated from `view.ts` and asserted by nothing,
  which is the price of the guard and worth naming. If this select is ever used outside
  `CatalogDetail`, move that test with it.
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

<script>
  // The final Docustay wordmark (specs/brand/docustay-logo). Vector only, never redrawn. Cream site (16 Oct 2026): "ink" = the violet D mark with the wordmark in ink; also white, violet, black.
  // 26 px tall on desktop, 22 px on phones; the giant faded footer wordmark uses the white file at 11% opacity.
  let { variant = "ink", height = 26, class: cls = "", alt = "Docustay" } = $props();
  const w = $derived(Math.round(height * (1252 / 253)));
</script>
<img class="dlogo {cls}" src="/brand/docustay-wordmark-{variant}.svg" {alt} width={w} height={height} decoding="async" style="height:{height}px;width:auto" />
<style>
  .dlogo { display: block; max-width: none; }
  @media (max-width: 700px) { .dlogo.hdr { height: 22px !important; } }
</style>

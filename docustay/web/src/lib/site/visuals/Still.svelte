<script>
  // A still 3D object (static/stills/hero-<name>.*), rendered offline by scripts/render-stills.mjs: transparent, 2x, no frame. Fixed width and height, so nothing shifts when it loads.
  let { name, alt = "", eager = false, max = 520 } = $props();
</script>
<picture class="still">
  <source type="image/avif" srcset={`/stills/hero-${name}.avif`} />
  <source type="image/webp" srcset={`/stills/hero-${name}.webp`} />
  <img src={`/stills/hero-${name}.png`} {alt} width="1040" height="800" decoding="async" loading={eager ? "eager" : "lazy"} fetchpriority={eager ? "high" : "auto"} style="max-width:{max}px" />
</picture>
<style>
  .still { display: block; } .still img { display: block; width: 100%; height: auto; }
</style>

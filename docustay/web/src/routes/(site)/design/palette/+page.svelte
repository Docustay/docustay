<script>
  // The V3 palette, every still object and every real-UI visual in one place (builders only: 404 unless DOCUSTAY_DESIGN_PREVIEW=1). Colour has meaning: one accent per area, on objects and eyebrows only.
  import { AREA } from "$lib/site/3d/palette.js";
  import { VISUALS } from "$lib/site/visuals/registry.js";
  import Visual from "$lib/site/visuals/Visual.svelte"; import Still from "$lib/site/visuals/Still.svelte";
  const stills = [...new Set(Object.values(VISUALS).filter((v) => v.still).map((v) => v.still))];
  const uis = [...new Set(Object.values(VISUALS).filter((v) => v.ui).map((v) => [v.ui, v.area].join("|")))].map((x) => x.split("|"));
</script>
<svelte:head><meta name="robots" content="noindex" /><title>Palette</title></svelte:head>
<main class="d-wrap" style="padding:120px 0 80px">
  <p class="d-eyebrow">DESIGN · VISUAL DIRECTION V3</p><h1 class="d-h1 sm">Colour by <em>area.</em></h1>
  <p class="d-sub">Violet stays the brand. Each area gets one accent for its objects and its eyebrow text, never for the page glow. Every accent is at least 4.5:1 on the page background.</p>
  <div class="sw">{#each Object.entries(AREA) as [k, a]}<div class="a"><i style="background:{a.accent}"></i><p class="d-eyebrow" style="color:{a.accent}">{a.name.toUpperCase()}</p><code>{a.accent}</code></div>{/each}</div>
  <h2 class="d-h2 sm">Stills ({stills.length})</h2><div class="g">{#each stills as n}<figure><Still name={n} alt={n} max={300} /><figcaption>{n}</figcaption></figure>{/each}</div>
  <h2 class="d-h2 sm">Real UI ({uis.length})</h2><div class="g u">{#each uis as [id, area]}<figure><Visual {id} {area} /><figcaption>{id}</figcaption></figure>{/each}</div>
</main>
<style>
  .sw { display: grid; grid-template-columns: repeat(7, 1fr); gap: 14px; margin: 28px 0 40px; } .a i { display: block; height: 56px; border-radius: 10px; margin-bottom: 8px; } .a code { font: 500 12px var(--f-mono); color: var(--tx-3); }
  .g { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 24px; margin: 20px 0 48px; } .u { grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); } figure { margin: 0; } figcaption { font: 500 12px var(--f-mono); color: var(--tx-3); margin-top: 6px; }
  @media (max-width: 900px) { .sw { grid-template-columns: repeat(2, 1fr); } }
</style>

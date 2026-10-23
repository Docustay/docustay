<script>
  import { onMount, tick } from "svelte";
  // One still object on a transparent canvas, for scripts/render-stills.mjs. Builders only: 404 unless DOCUSTAY_DESIGN_PREVIEW=1.
  let cv = $state(null), ready = $state(false), err = $state("");
  const q = typeof location === "undefined" ? new URLSearchParams() : new URLSearchParams(location.search);
  onMount(async () => {
    await tick();
    try { await document.fonts.load("600 40px Geist"); await document.fonts.load("700 40px 'JetBrains Mono'"); await document.fonts.load("italic 40px 'Instrument Serif'"); await document.fonts.ready;
      const m = await import("$lib/site/3d/objects.js"); m.renderStill(cv, q.get("name"), { width: 1040, height: 800, scale: Number(q.get("scale") ?? 1) }); } catch (e) { err = String(e); }
    requestAnimationFrame(() => requestAnimationFrame(() => { ready = true; }));
  });
</script>
<svelte:head><meta name="robots" content="noindex" /><title>Still</title></svelte:head>
<canvas bind:this={cv} id="still" data-ready={ready} data-err={err} style="display:block;width:1040px;height:800px;background:transparent"></canvas>

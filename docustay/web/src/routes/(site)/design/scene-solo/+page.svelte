<script>
  import { onMount, tick } from "svelte";
  // One scene at a fixed time, 1200x750, for the poster script (scripts/render-3d-posters.mjs). Builders only: 404 unless DOCUSTAY_DESIGN_PREVIEW=1.
  let host = $state(null), ready = $state(false), err = $state("");
  onMount(async () => {
    const q = new URLSearchParams(location.search); await tick();
    try { const m = await import("$lib/site/3d/scenes.js"); const api = m.mountScene(host, q.get("solo") ?? "hero", { fixedT: Number(q.get("t") ?? 2.2) }); if (!api) err = "no scene"; await document.fonts.ready; } catch (e) { err = String(e); }
    requestAnimationFrame(() => requestAnimationFrame(() => { ready = true; }));
  });
</script>
<svelte:head><meta name="robots" content="noindex" /><title>Scene</title></svelte:head>
<div bind:this={host} id="solo" data-ready={ready} data-err={err} style="position:relative;width:1200px;height:750px;background:#f7f6fc"></div>

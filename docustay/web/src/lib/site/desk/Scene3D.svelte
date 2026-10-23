<script>
  import { onMount } from "svelte";
  import { acquire, release } from "../3d/pool.js";
  // One 3D scene (three.js, MIT). V2 names: hero D cube papers lattice seal cards rings bg. Old names (stack route chain demo) still work: "stack" is the hero scene, the rest use the older paper scenes.
  // Rules (SITE-V2-BLUEPRINT §6.4): the poster (an image in the HTML) is what first paint and crawlers see; three.js is not downloaded until the scene is within a screen of the viewport and the page is idle; at most two live contexts at once; the loop pauses off-screen and the context is released when the scene is far away;
  // phones (under 900 px), reduced motion and no-WebGL keep the poster and never start WebGL. The scene is decoration (aria-hidden); the words beside it say the same thing.
  let { kind = "hero", label = "", fill = false, soft = false } = $props();
  const V2 = ["hero", "D", "cube", "papers", "lattice", "seal", "cards", "rings", "bg"];
  const name = $derived(kind === "stack" ? "hero" : kind);
  const isV2 = $derived(V2.includes(name));
  let host = $state(null), live = $state(false), failed = $state(false);
  const id = Math.random().toString(36).slice(2);
  const settled = () => new Promise((go) => { const idle = () => (window.requestIdleCallback ? requestIdleCallback(go, { timeout: 3000 }) : setTimeout(go, 1500)); if (document.readyState === "complete") setTimeout(idle, 400); else addEventListener("load", () => setTimeout(idle, 400), { once: true }); });
  onMount(() => {
    if (!host) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches, phone = matchMedia("(max-width: 899px)").matches;
    if (reduced || phone) return;
    let api = null, wanted = false, busy = false, alive = true;
    const lite = (navigator.hardwareConcurrency || 8) < 5 || (navigator.getBattery ? false : false);
    const start = async () => {
      if (api || busy || !alive) return; busy = true;
      try {
        if (!acquire(id, () => { if (wanted) start(); })) { busy = false; return; }
        await settled();
        if (!wanted || !alive) { release(id); busy = false; return; }
        if (name === "hero") { const m = await import("../3d/d-live.js"); api = m.mountD(host); }
        else if (isV2) { const m = await import("../3d/scenes.js"); api = m.mountScene(host, name, { lite }); if (!api) { release(id); failed = true; busy = false; return; } }
        else { const m = await import("./scene3d-run.js"); api = await m.run(host, kind, { reduced: false }); const a = api; api = { visible: a.visible, dispose: a.dispose }; }
        live = true;
      } catch { failed = true; release(id); }
      busy = false;
    };
    const stop = () => { if (!api) return; api.dispose(); api = null; live = false; release(id); };
    const near = new IntersectionObserver(([e]) => { wanted = e.isIntersecting; if (wanted) start(); }, { rootMargin: "100% 0px" });
    const on = new IntersectionObserver(([e]) => api?.visible(e.isIntersecting), { rootMargin: "40px" });
    const far = new IntersectionObserver(([e]) => { if (!e.isIntersecting) { wanted = false; stop(); } }, { rootMargin: "250% 0px" });
    near.observe(host); on.observe(host); far.observe(host);
    return () => { alive = false; near.disconnect(); on.disconnect(); far.disconnect(); stop(); };
  });
</script>
<div class="s3" class:fill class:soft bind:this={host} aria-hidden="true" data-scene={name} data-ready={live && !failed}>
  {#if name === "hero"}<picture><source type="image/avif" srcset="/stills/hero-D.avif" /><source type="image/webp" srcset="/stills/hero-D.webp" /><img class="post contain" class:gone={live} src="/stills/hero-D.png" width="1040" height="800" alt="" decoding="async" loading="eager" fetchpriority="high" /></picture>{:else if isV2}<img class="post" class:gone={live} src={`/3d/${name}.webp`} width="1200" height="750" alt="" decoding="async" loading={name === "hero" ? "eager" : "lazy"} fetchpriority={name === "hero" ? "high" : "auto"} />{/if}
</div>
<style>
  .s3 { position: relative; width: 100%; aspect-ratio: 16 / 10; min-height: 260px; max-height: 520px; overflow: hidden; border-radius: inherit; background: var(--ground, #f7f6fc); }
  .s3.soft { background: transparent; aspect-ratio: 1 / 1; max-height: 560px; min-height: 0; }
  .s3.fill { position: absolute; inset: 0; aspect-ratio: auto; max-height: none; min-height: 0; }
  .s3 :global(canvas) { position: absolute; inset: 0; width: 100% !important; height: 100% !important; display: block; }
  .post { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; transition: opacity var(--d-base, .28s); }
  .post.gone { opacity: 0; } .post.contain { object-fit: contain; } .s3 picture { display: contents; }
</style>

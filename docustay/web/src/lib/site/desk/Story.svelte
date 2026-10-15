<script>
  import Sec from "./Sec.svelte";
  import Figure from "./Figure.svelte";
  import Screen from "./Screen.svelte";
  import { feat } from "./feat.js";
  // Sticky scroll steps: the step nearest the middle of the screen is the active one, and the sticky screen shows its picture. On a phone every step carries its own screen inline.
  let { b } = $props();
  let on = $state(0), list = $state(null);
  const pick = () => { if (!list) return; const mid = innerHeight * 0.45; let best = 0, gap = Infinity; [...list.children].forEach((li, i) => { const r = li.getBoundingClientRect(); const d = Math.abs((r.top + r.bottom) / 2 - mid); if (d < gap) { gap = d; best = i; } }); on = best; };
  $effect(() => { if (!list || typeof IntersectionObserver === "undefined") return; let raf = 0; const run = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(pick); }; let live = false; const io = new IntersectionObserver(([e]) => { if (e.isIntersecting && !live) { live = true; addEventListener("scroll", run, { passive: true }); addEventListener("resize", run); run(); } else if (!e.isIntersecting && live) { live = false; removeEventListener("scroll", run); removeEventListener("resize", run); } }, { rootMargin: "100px" }); io.observe(list); return () => { io.disconnect(); removeEventListener("scroll", run); removeEventListener("resize", run); cancelAnimationFrame(raf); }; });
</script>
<Sec id={b.id} eyebrow={b.eyebrow} title={b.h2} sub={b.sub ? feat(b.sub).text : ""} tight>
  <div class="story">
    <ol class="sl" bind:this={list}>{#each b.steps as st, i}{@const x = feat(st.p)}<li class:on={on === i} data-feature={x.ids}><b>{String(i + 1).padStart(2, "0")}</b><h3>{st.h}</h3><p>{x.text}</p><div class="inl"><Screen kind={st.kind} /></div></li>{/each}</ol>
    <div class="stick"><Figure caption={b.caption ?? "FIG. · STEP BY STEP"} note="SAMPLE DATA">{#key on}<Screen kind={b.steps[on].kind} />{/key}</Figure></div>
  </div>
</Sec>
<style>
  .story { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.05fr); gap: 40px; align-items: start; } .sl { list-style: none; margin: 0; padding: 0; display: grid; gap: 0; } .sl li { min-height: 38vh; display: grid; align-content: center; gap: 10px; opacity: .78; transition: opacity .3s; padding: 12px 0; } .sl li.on { opacity: 1; } .sl b { font: 500 12px var(--font-mono); letter-spacing: .14em; color: #a9a9fe; } .sl h3 { margin: 0; font: 600 28px/1.15 var(--font-sans); letter-spacing: -.02em; } .sl p { margin: 0; color: #b4afa5; line-height: 1.6; max-width: 46ch; } .stick { position: sticky; top: 110px; } .inl { display: none; }
  @media (max-width: 900px) { .story { grid-template-columns: 1fr; } .stick { display: none; } .sl li { min-height: 0; opacity: 1; padding: 18px 0; } .inl { display: block; margin-top: 12px; } }
  @media (prefers-reduced-motion: reduce) { .sl li { transition: none; } }
</style>

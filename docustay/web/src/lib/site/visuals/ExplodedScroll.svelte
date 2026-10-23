<script>
  // The anatomy of a signed document, driven by scroll (V3: the one place besides the home D where the movement explains something). As the figure scrolls into view the layers lift apart, in order:
  // page, fields, signatures, seal, certificate. It moves only while the person scrolls; reduced motion shows it fully taken apart, still. Nothing animates by itself.
  import { onMount } from "svelte";
  import { AREA } from "../3d/palette.js";
  let { area = "home", fixed = false, compact = false } = $props();
  let el = $state(null), p = $state(1);   // p: 0 = assembled, 1 = apart
  const ac = $derived(AREA[area].accent);
  const LAYERS = [["Page", "The document as it was sent"], ["Fields", "Every box that was filled in"], ["Signatures", "Who signed, and when"], ["Seal", "SHA-256 of the finished PDF"], ["Certificate", "A record anyone can verify"]];
  onMount(() => {
    if (!el || fixed || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0; const paint = () => { raf = 0; const r = el.getBoundingClientRect(), vh = innerHeight; p = Math.max(0, Math.min(1, (vh * 0.95 - r.top) / (vh * 0.7))); };
    const on = () => { if (!raf) raf = requestAnimationFrame(paint); }; paint(); addEventListener("scroll", on, { passive: true }); addEventListener("resize", on);
    return () => { removeEventListener("scroll", on); removeEventListener("resize", on); cancelAnimationFrame(raf); };
  });
</script>
<div class="ex" class:compact bind:this={el} style="--ac:{ac};--p:{p}" role="img" aria-label="The layers of a sealed document separating as you scroll: page, fields, signatures, seal and certificate">
  <div class="stage">{#each LAYERS as [n], i}<div class="ly" style="--i:{i}"><span>{n}</span></div>{/each}</div>
  <ol class="key" aria-hidden="true">{#each LAYERS as [n, d], i}<li style="--i:{i}"><b>{n}</b><span>{d}</span></li>{/each}</ol>
</div>
<style>
  .ex { display: grid; grid-template-columns: minmax(0, 260px) minmax(0, 1fr); gap: 20px; align-items: center; width: 100%; max-width: 560px; min-height: 340px; }
  .stage { position: relative; height: 320px; perspective: 1000px; transform-style: preserve-3d; }
  .ly { position: absolute; left: 50%; top: calc(250px - var(--i) * 34px * var(--p) - (1 - var(--p)) * var(--i) * 3px); width: 200px; height: 130px; margin-left: -100px; border-radius: 10px; display: grid; place-items: center; font: 600 12px var(--f-mono, monospace); color: #17161f; transform: rotateX(58deg) rotateZ(-32deg); background: color-mix(in srgb, var(--ac) calc(var(--i) * 18%), #fbfaf6); box-shadow: 0 12px 24px -14px rgb(60 40 140 / 0.3); }
  .ly:nth-child(2) { border: 2px dashed var(--ac); } .ly span { transform: rotateZ(32deg) rotateX(-58deg); } .ly:last-child { color: #fff; background: var(--ac); }
  .key { list-style: none; margin: 0; padding: 0; display: grid; gap: 14px; align-content: center; } .key li { display: grid; gap: 2px; border-left: 2px solid var(--ac); padding-left: 12px; opacity: calc(.25 + var(--p) * .75); } .key b { font: 600 13px var(--f-ui); color: var(--tx-1, var(--tx-1)); } .key span { font-size: 12.5px; color: var(--tx-3, var(--tx-2)); }
  .ex.compact { grid-template-columns: 1fr; max-width: 260px; min-height: 0; } .ex.compact .key { display: none; }
  @media (max-width: 560px) { .ex { grid-template-columns: 1fr; } .key { display: none; } }
</style>

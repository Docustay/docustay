<script>
  // The one hero visual of a page, picked from the registry by path (V3 section 3). A still 3D object, a small real UI, or one of two scroll-driven pieces. Never a frame, never animated by itself.
  import { page } from "$app/state";
  import { heroIdFor, VISUALS } from "./registry.js";
  import Visual from "./Visual.svelte"; import Still from "./Still.svelte"; import ExplodedScroll from "./ExplodedScroll.svelte";
  import { Shelf } from "../../fx3d/index.js";
  import { SIGNPDF } from "../signpdf.js";
  let { id = null } = $props();
  const vid = $derived(id ?? heroIdFor(page.url.pathname));
  const def = $derived(vid && vid !== "LIVE" ? VISUALS[vid] : null);
  const slug = $derived(page.url.pathname.split("/")[2]);
  const lang = $derived(def?.ui === "signpdf-lang" ? SIGNPDF.find((l) => l.slug === slug) : null);
  const code = $derived(lang ? lang.code.split("\n").filter((l) => l.trim()).slice(0, 9).join("\n") : "");
  const THUMBS = ["nda", "lease", "offer-letter", "contractor"];
</script>
{#if def}
  <figure class="hv" data-hero={vid} data-area={def.area}>
    {#if def.still}<Still name={def.still} alt={def.alt} eager />{#if def.with}<div class="under"><Visual id={def.with} area={def.area} size="hero" /></div>{/if}
    {:else if def.special === "exploded-scroll"}<ExplodedScroll area={def.area} />
    {:else if def.special === "shelf"}<div class="shelf" aria-label={def.alt}><Shelf label="Template pages">{#each THUMBS as n}<img src={`/screens/doc-${n}.png`} alt="" width="190" height="247" loading="lazy" />{/each}</Shelf></div>
    {:else if lang}<div class="sp"><Visual id="signpdf-langs" area={def.area} size="hero" /><div class="cw"><p class="cap">{lang.name.toUpperCase()}</p><pre>{code}</pre></div></div>
    {:else}<div role="img" aria-label={def.alt}><Visual id={def.ui} area={def.area} size="hero" /></div>{/if}
  </figure>
{/if}
<style>
  .hv { margin: 0; display: grid; justify-items: center; align-content: center; gap: 14px; min-width: 0; } .hv :global(.v.hero) { zoom: 1.2; } .under { margin-top: -8px; }
  .shelf { width: min(560px, 100%); } .shelf img { height: 247px; width: auto; border-radius: 6px; box-shadow: 0 16px 30px -16px #000; } @media (max-width: 640px) { .shelf img { height: 150px; } }
  .sp { display: grid; gap: 14px; justify-items: center; } .cw { width: 400px; max-width: 100%; border: 1px solid var(--hairline); border-radius: 12px; background: #ffffff; padding: 12px 16px; } .cw .cap { margin: 0 0 6px; font: 600 10.5px var(--f-mono, monospace); letter-spacing: .1em; color: #0b6f7a; } .cw pre { margin: 0; font: 400 11px/1.5 var(--f-mono, monospace); color: var(--tx-1); overflow: hidden; }
  @media (max-width: 899px) { .hv :global(.v.hero) { zoom: 1; } }
</style>

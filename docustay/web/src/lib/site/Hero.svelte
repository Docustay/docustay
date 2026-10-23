<script>
  import HeroVisual from "./visuals/HeroVisual.svelte"; import { heroIdFor } from "./visuals/registry.js"; import { page } from "$app/state";
  // The top of an inner page on the Desk look: mono eyebrow, a Geist H1, the lede, the page's own buttons as children. Used by the pages that keep their own working parts (verify, status, contact, self-host).
  // V2: a `scene` puts a live 3D scene in a glass frame beside the words; without one the page still sits in a violet dotted room (Backdrop C3), never on a flat ground.
  let { eyebrow = null, title, lede = null, scene = null, children } = $props();   // `scene` is ignored (V3): the visual comes from the registry by path
  const has = $derived(!!heroIdFor(page.url.pathname));
  // *word* in the title becomes the one italic violet accent word (the text is escaped first)
  const html = $derived(title.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\*([^*]+)\*/g, "<em>$1</em>"));
</script>
<div class="phw">
  <section class="d-wrap ph2" class:two={has}>
    <div class="ph2-l">
      {#if eyebrow}<p class="d-eyebrow">{eyebrow}</p>{/if}
      <h1 class="d-h1 sm" style={eyebrow ? "" : "margin-top:0"}>{@html html}</h1>
      {#if lede}<p class="d-sub">{lede}</p>{/if}
      <div class="d-actions empty:hidden">{@render children?.()}</div>
    </div>
    {#if has}<div class="ph2-r"><HeroVisual /></div>{/if}
  </section>
</div>
<style>
  .phw { position: relative; isolation: isolate; } .phw > :global(.bd) { z-index: -1; -webkit-mask-image: linear-gradient(to bottom, #000 55%, transparent); mask-image: linear-gradient(to bottom, #000 55%, transparent); }
  .ph2 { padding-top: 104px; padding-bottom: 20px; } .ph2 :global(.d-actions:empty) { display: none; } .ph2.two { display: grid; grid-template-columns: minmax(0, 1.02fr) minmax(0, 1fr); gap: 30px; align-items: center; padding-top: 128px; } .ph2-l, .ph2-r { min-width: 0; }
  @media (max-width: 900px) { .ph2.two { grid-template-columns: minmax(0, 1fr); padding-top: 104px; } }
</style>

<script>
  import HeroVisual from "../visuals/HeroVisual.svelte"; import { heroIdFor } from "../visuals/registry.js"; import { page } from "$app/state";
  // The first screen of a hand-built public page (V3): the words on the left, the page's one hero visual on the right (a still object or a small real UI, from visuals/registry.js), straight on the page background.
  // The registry pages get the same thing from PageView. `children` is the left column (eyebrow, H1, sub, buttons).
  let { scene = undefined, backdrop = undefined, id = undefined, children, cls = "" } = $props();   // `scene` and `backdrop` are ignored (V3): the visual comes from the registry by path
  const has = $derived(!!heroIdFor(page.url.pathname));
</script>
<div class="phw">
  <section class="d-wrap sh {cls}" class:one={!has} {id}>
    <div class="sh-l">{@render children()}</div>
    {#if has}<div class="sh-r"><HeroVisual /></div>{/if}
  </section>
</div>
<style>
  .phw { position: relative; isolation: isolate; } .phw > :global(.bd) { z-index: -1; -webkit-mask-image: linear-gradient(to bottom, #000 55%, transparent); mask-image: linear-gradient(to bottom, #000 55%, transparent); }
  .sh { position: relative; display: grid; grid-template-columns: minmax(0, 1.02fr) minmax(0, 1fr); gap: 30px; align-items: center; padding-top: 132px; padding-bottom: 20px; } .sh-l, .sh-r { min-width: 0; }
  .sh.one { grid-template-columns: minmax(0, 1fr); }
  @media (max-width: 900px) { .sh { grid-template-columns: minmax(0, 1fr); padding-top: 104px; } }
</style>

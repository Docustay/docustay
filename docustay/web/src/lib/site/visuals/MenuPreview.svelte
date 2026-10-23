<script>
  // The one preview panel of a mega menu (V3 section 2): a still object or a small real UI for the link under the pointer or keyboard focus, then its name and one short line.
  // About 340 x 300. A 160 ms fade between previews and nothing else moves. Not shown on phones.
  import { VISUALS, PREVIEW } from "./registry.js";
  import Visual from "./Visual.svelte"; import Still from "./Still.svelte";
  let { href, name = "" } = $props();
  const id = $derived(PREVIEW[href] ?? null);
  const def = $derived(id ? VISUALS[id] : null);
</script>
<div class="mp" aria-hidden="true">
  {#key href}{#if def}
    <div class="fade">
      <div class="stage">
        {#if def.still}<div class="st"><Still name={def.still} alt="" max={def.with ? 190 : 250} /></div>{#if def.with}<div class="w"><Visual id={def.with} area={def.area} size="menu" /></div>{/if}
        {:else if def.ui}<div class="ui"><Visual id={def.ui} area={def.area} size="menu" /></div>{/if}
      </div>
      <p class="nm">{name}</p><p class="ln">{def.line}</p>
    </div>
  {/if}{/key}
</div>
<style>
  .mp { width: 340px; height: 300px; overflow: hidden; border-radius: 14px; background: #ffffff; border: 1px solid var(--hairline); padding: 12px 0 0; display: grid; align-content: start; }
  .fade { animation: fade 160ms ease-out; } @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
  .stage { height: 218px; display: grid; justify-items: center; align-content: center; overflow: hidden; } .ui { transform: scale(.74); transform-origin: center; } .ui :global(.v) { min-height: 0; } .st { display: grid; justify-items: center; } .w { transform: scale(.55); transform-origin: top center; height: 80px; margin-top: -8px; }
  .nm { margin: 8px 16px 0; font: 500 14px/1.2 var(--f-ui); color: var(--tx-1); } .ln { margin: 4px 16px 0; font-size: 12.5px; color: var(--tx-3); line-height: 1.4; }
  @media (prefers-reduced-motion: reduce) { .fade { animation: none; } }
</style>

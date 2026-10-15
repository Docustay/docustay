<script>
  // Titled sections of a page. `tiles` (default) makes a two-column grid of rounded cards, each with a hand-drawn doodle; `rows` makes a heading-left, text-right row per section with a thin rule between (for longer reading).
  import Doodle from "$lib/doodle/Doodle.svelte";
  import { shown } from "$lib/fx/index.js";
  let { sections, variant = "tiles", doodles = ["doc-corner", "pen", "check", "envelope", "lock", "calendar", "seal", "key"] } = $props();
</script>
{#if variant === "rows"}
  <div class="rows">{#each sections as [h, p], i}<section class="row reveal" style="--i:{i % 3}" {@attach shown(0.2)}><h2 class="t-h3">{h}</h2><div>{#each String(p).split("\n\n") as para}<p>{para}</p>{/each}</div></section>{/each}</div>
{:else}
  <div class="tiles">{#each sections as [h, p], i}<section class="t reveal lift t{i % 4}" style="--i:{i % 2}" {@attach shown(0.2)}><Doodle name={doodles[i % doodles.length]} size="4.5rem" /><h2 class="t-h3 mt-4">{h}</h2>{#each String(p).split("\n\n") as para}<p>{para}</p>{/each}</section>{/each}</div>
{/if}
<style>
  .tiles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1.25rem; padding-block: clamp(2rem, 5vw, 4rem); }
  .t { padding: clamp(1.4rem, 3vw, 2.25rem); border-radius: var(--r-5); background: var(--card); border: 1px solid var(--line); } .t p { margin-top: .75rem; color: var(--mute); line-height: 1.7; font-size: 1.04rem; }
  .t1 { background: var(--lilac-soft); } .t2 { background: var(--lilac-soft); } .t3 { background: var(--card); }
  .rows { padding-block: clamp(1.5rem, 4vw, 3rem); } .row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr); gap: clamp(1rem, 4vw, 3.5rem); padding-block: clamp(1.5rem, 3vw, 2.5rem); border-top: 1px solid var(--line); } .row:first-child { border-top: 0; }
  .row h2 { position: sticky; top: 5.5rem; align-self: start; } .row p { color: var(--ink); opacity: .85; line-height: 1.75; font-size: 1.08rem; max-width: 44rem; } .row p + p { margin-top: 1rem; }
  @media (max-width: 799px) { .tiles { grid-template-columns: 1fr; } .row { grid-template-columns: 1fr; } .row h2 { position: static; } }
</style>

<script>
  // A terminal that plays its lines once when it scrolls into view. EVERY line is in the first HTML; the animation only fades them in one by one (reduced motion and no-JavaScript show them all).
  // lines: [{ t: "cmd" | "out" | "ok" | "event" | "dim", s: "text" }]
  import { whenVisible } from "../desk/reveal.js";
  let { lines, title = "terminal", class: cls = "" } = $props();
  let played = $state(false);
</script>
<div class="tm {cls}" class:played {@attach whenVisible((v) => { if (v) played = true; })}>
  <div class="bar"><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="ttl">{title}</span></div>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex --><pre tabindex="0"><code>{#each lines as l, i}<span class="l {l.t}" style="--i:{i}">{#if l.t === "cmd"}<b>$</b> {/if}{l.s}</span>
{/each}</code></pre>
</div>
<style>
  .tm { border-radius: var(--r-4); border: 1px solid var(--ln-2); background: #fff; overflow: hidden; box-shadow: var(--sh-card); min-width: 0; text-align: left; }
  .bar { display: flex; align-items: center; gap: 12px; padding: 11px 16px; border-bottom: 1px solid var(--ln-1); background: #faf9fe; } .dots { display: inline-flex; gap: 6px; } .dots i { width: 9px; height: 9px; border-radius: 50%; background: #dcd8ea; } .ttl { font: 12px var(--f-mono); color: var(--tx-3); }
  pre { margin: 0; padding: 16px 20px 20px; overflow-x: auto; font: 400 13px/1.8 var(--f-mono); color: var(--tx-2); }
  .l { display: block; } .cmd b { color: var(--tx-3); font-weight: 400; } .cmd { color: var(--tx-1); } .ok { color: var(--ok); } .event { color: #0b6f7a; } .dim { color: var(--tx-3); }
  :global(html.js) .tm:not(.played) .l { opacity: 0; transform: translateY(6px); } :global(html.js) .tm.played .l { opacity: 1; transform: none; transition: opacity .35s var(--e-out) calc(var(--i) * .55s), transform .35s var(--e-out) calc(var(--i) * .55s); }
  @media (prefers-reduced-motion: reduce) { :global(html.js) .tm .l { opacity: 1 !important; transform: none !important; transition: none !important; } }
</style>

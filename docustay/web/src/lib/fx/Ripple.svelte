<script>
  // MOTION 3 · A NEW RESPONSE (Run 8 board, Done 5): a ripple spreads from the dot and the count rolls up to the new number. `count` is the new total (optional). Reduced motion: the number, still.
  import { Tween } from "svelte/motion";
  import { cubicOut } from "svelte/easing";
  import { untrack } from "svelte";
  import { calm } from "./index.js";
  let { count = null } = $props();
  const n = new Tween(untrack(() => (count == null ? 0 : Math.max(0, count - 1))), { duration: calm() ? 0 : 700, easing: cubicOut });
  $effect(() => { if (count != null) n.set(count); });
</script>
<span class="rp" aria-hidden="true" data-testid="fx-ripple"><span class="dot"></span><span class="ring"></span><span class="ring r2"></span>{#if count != null}<b class="num">{Math.round(n.current)}</b>{/if}</span>
<style>
  .rp { position: relative; display: inline-flex; align-items: center; gap: 10px; height: 40px; padding-left: 14px; flex: none; }
  .dot, .ring { position: absolute; left: 8px; top: 50%; width: 12px; height: 12px; margin-top: -6px; border-radius: 50%; }
  .dot { background: #5A3AC1; }
  .ring { border: 2px solid #8585fd; animation: rp-go 1.4s cubic-bezier(.2,.8,.2,1) both; }
  .r2 { animation-delay: 260ms; }
  .num { margin-left: 22px; font: 600 22px/1 var(--font-sans, system-ui); font-variant-numeric: tabular-nums; color: var(--ink); }
  @keyframes rp-go { from { transform: scale(1); opacity: .9; } to { transform: scale(3.4); opacity: 0; } }
  @media (prefers-reduced-motion: reduce) { .ring { display: none; } }
  :global(html[data-lite]) .r2 { display: none; }
</style>

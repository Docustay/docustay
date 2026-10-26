<script>
  // Run 7 part 8 — A SUCCESS MOMENT: a tick that draws itself in a ring, the sentence, and whatever comes next (a link, a button) rising in after it. Used when a document is sent, a document
  // is signed and sealed, a form is published and a response arrives. Shown once, never blocks: everything is clickable at once. Reduced motion: the finished tick, still.
  // Run 8: `art` picks the board's picture for the moment — "tick" (default), "envelope" (sent), "stamp" (signed and sealed), "ripple" (a new response, with `count`).
  import Envelope from "./Envelope.svelte";
  import Stamp from "./Stamp.svelte";
  import Ripple from "./Ripple.svelte";
  let { title = "", line = "", tone = "ok", testid = "success", art = "tick", count = null, stampLabel = "SEALED", children } = $props();
</script>
<div class="sx" data-tone={tone} role="status" data-testid={testid}>
  {#if art === "envelope"}<Envelope />{:else if art === "stamp"}<Stamp label={stampLabel} />{:else if art === "ripple"}<Ripple {count} />{:else}<span class="sx-ring" aria-hidden="true"><svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="17" /><path d="M12.5 20.5l5 5L28 15" /></svg></span>{/if}
  <div class="body"><p class="tt">{title}</p>{#if line}<p class="ln">{line}</p>{/if}{#if children}<div class="nx">{@render children()}</div>{/if}</div>
</div>
<style>
  .sx { display: flex; gap: 14px; align-items: flex-start; }
  .sx-ring { flex: none; width: 40px; height: 40px; } .sx-ring svg { width: 100%; height: 100%; fill: none; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
  .sx[data-tone="ok"] svg { stroke: var(--ok, #0b6a40); } .sx[data-tone="brand"] svg { stroke: var(--brand, #5a3ac1); }
  circle { stroke-dasharray: 107; stroke-dashoffset: 107; animation: sx-draw var(--dur-slow) var(--ease-out) forwards; opacity: .35; }
  path { stroke-dasharray: 26; stroke-dashoffset: 26; animation: sx-draw var(--dur-base) var(--ease-out) var(--dur-base) forwards; }
  .tt { margin: 0; font-size: 1.1rem; font-weight: 600; } .ln { margin: 2px 0 0; color: var(--mute); font-size: .92rem; }
  .nx { margin-top: 10px; animation: sx-rise var(--dur-slow) var(--ease-out) 240ms both; }
  @keyframes sx-draw { to { stroke-dashoffset: 0; } }
  @keyframes sx-rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
  @media (prefers-reduced-motion: reduce) { circle, path, .nx { animation: none !important; stroke-dashoffset: 0; opacity: 1; } circle { opacity: .35; } }
</style>

<script>
  import { whenVisible } from "./reveal.js";
  // A terminal that plays a short real session when it comes into view: a typed command, then its output. `lines` are { k: "cmd" | "out" | "dim" | "ok", t }. With reduced motion, or no scripts, the whole session is simply there.
  let { lines = [], title = "terminal" } = $props();
  let shown = $state(lines.map((l) => (l.k === "cmd" ? l.t.length : l.t.length))), done = $state(false), started = false;
  const reduced = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  async function play() {
    if (started || reduced) return; started = true; shown = lines.map(() => 0); done = false;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].k === "cmd") { for (let c = 1; c <= lines[i].t.length; c++) { shown[i] = c; await new Promise((r) => setTimeout(r, 22)); } await new Promise((r) => setTimeout(r, 260)); }
      else { shown[i] = lines[i].t.length; await new Promise((r) => setTimeout(r, 110)); }
    }
    done = true;
  }
</script>
<div class="cn" role="img" aria-label={`${title}: ${lines.map((l) => l.t).join(". ")}`} {@attach whenVisible((v) => { if (v) play(); })} data-console>
  <div class="bar"><i></i><i></i><i></i><span>{title}</span></div>
  <div class="body"><pre class="ghost" aria-hidden="true">{#each lines as l}<span class="l">{#if l.k === "cmd"}<b>$ </b>{/if}{l.t}</span>
{/each}<span class="l cur"><b>$ </b><u></u></span></pre>
  <pre class="live" aria-hidden="true">{#each lines as l, i}{#if shown[i] > 0}<span class="l {l.k}">{#if l.k === "cmd"}<b>$ </b>{/if}{l.t.slice(0, shown[i])}{#if l.k === "cmd" && shown[i] < l.t.length}<u></u>{/if}</span>
{/if}{/each}{#if done || reduced}<span class="l cur"><b>$ </b><u></u></span>{/if}</pre></div>
</div>
<style>
  .cn { background: #ffffff; border: 1px solid var(--hairline); border-radius: 8px; overflow: hidden; } .bar { display: flex; align-items: center; gap: 7px; padding: 9px 12px; border-bottom: 1px solid var(--hairline); background: #ffffff; } .bar i { width: 9px; height: 9px; border-radius: 50%; background: #3a3a3d; } .bar span { margin-left: 8px; font: 500 11px var(--font-mono); letter-spacing: .1em; color: var(--tx-3); text-transform: uppercase; }
  pre { margin: 0; padding: 18px 20px; font: 400 13px/1.8 var(--font-mono); color: var(--tx-1); overflow-x: auto; min-height: 200px; white-space: pre-wrap; word-break: break-word; } .l b { color: var(--v-700); font-weight: 600; } .dim { color: var(--tx-3); } .ok { color: #1c7448; } .cmd { color: var(--tx-1); }
  u { display: inline-block; width: 8px; height: 1.05em; background: #f4f2ec; vertical-align: text-bottom; margin-left: 2px; animation: blink 1s steps(1) infinite; } @keyframes blink { 50% { opacity: 0; } }
  .body { position: relative; } .ghost { visibility: hidden; } .live { position: absolute; inset: 0; }
</style>

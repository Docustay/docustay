<script>
  // LAYOUT C · THE LIVE BUILD (Run 8, OptionC): while Scribe is making a document or a form, the page itself shows the work — a sheet that sways a little in 3D, its parts dropping in one by one, the
  // part being added glowing, and a chip "Scribe is building this page". It covers the page area only (never the sidebar or the panel), takes no clicks (`pointer-events: none` apart from the chip),
  // and leaves the moment the step ends: a tick, then it fades. Reduced motion: the finished sheet, still. Only mounted by ChatAssistant in layout C while a build step runs.
  import { onMount } from "svelte";
  import { t } from "$lib/i18n/index.svelte.js";
  let { build = null, phase = "running", rect = null, onstop = () => {} } = $props();
  const parts = $derived(build?.parts?.length ? build.parts : [{ t: "heading", label: build?.title || "" }, { t: "text" }, { t: "field" }, { t: "field" }, { t: "text" }, { t: "signature" }]);
  let shown = $state(1);
  const done = $derived(phase !== "running");
  // the parts keep dropping in at their own pace even when the step ends early (a quick save), only faster, so the page is always seen being built; reduced motion: all at once
  onMount(() => { if (matchMedia("(prefers-reduced-motion: reduce)").matches) { shown = parts.length; return; } let id; const tick = () => { if (shown < parts.length) shown += 1; id = setTimeout(tick, done ? 110 : 260); }; id = setTimeout(tick, 260); return () => clearTimeout(id); });
  const isForm = $derived(build?.kind === "form");
</script>
<div class="lb" class:done style={rect ? `left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px` : ""} data-testid="chat-live-build" data-state={phase} aria-hidden="true">
  <div class="chip" role="status"><span class="dot"></span>{done ? t("Built") : t("Scribe is building this page")}<button type="button" class="stop" tabindex="-1" onclick={onstop} hidden={done}>{t("Stop")}</button></div>
  <div class="stage">
    <div class="sheet" class:form={isForm}>
      {#if build?.title}<div class="ttl">{build.title}</div>{/if}
      {#each parts.slice(0, shown) as p, i (i)}
        <div class="part" data-k={p.t} class:active={!done && i === shown - 1}>
          {#if p.t === "heading"}<b class="h"></b>
          {:else if p.t === "text"}<i></i><i style="width:82%"></i><i style="width:64%"></i>
          {:else if p.t === "signature"}<span class="lab">{p.label || t("Signature")}</span><span class="sig"></span>
          {:else}<span class="lab">{p.label}</span><span class="box" data-file={p.t === "file" ? "" : undefined}></span>{/if}
        </div>
      {/each}
      {#if done && shown >= parts.length}<span class="tick"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></span>{/if}
    </div>
  </div>
</div>
<style>
  .lb { position: fixed; z-index: 35; pointer-events: none; display: grid; place-items: center; background: color-mix(in srgb, var(--paper) 86%, transparent); backdrop-filter: blur(2px); animation: lb-in 260ms cubic-bezier(.2,.8,.2,1); }
  .lb.done { animation: lb-out 420ms cubic-bezier(.2,.8,.2,1) 1700ms forwards; }
  .chip { position: absolute; top: 16px; right: 16px; display: inline-flex; align-items: center; gap: 8px; height: 30px; padding: 0 6px 0 12px; border-radius: 999px; background: var(--card); border: 1px solid var(--line); box-shadow: 0 4px 14px rgb(40 25 100 / .08); font-size: 12.5px; color: var(--ink); pointer-events: auto; }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--brand); animation: lb-breathe 1.6s ease-in-out infinite; }
  .done .dot { background: var(--ok); animation: none; }
  .stop { border: 0; background: var(--tint); color: var(--ink); border-radius: 999px; height: 22px; padding: 0 10px; font: inherit; font-size: 12px; cursor: pointer; }
  .stage { perspective: 1400px; width: min(560px, 82%); }
  .sheet { position: relative; display: grid; gap: 14px; align-content: start; min-height: min(620px, 70vh); padding: 40px 44px; background: #fff; color: #16161d; border-radius: 8px; box-shadow: 0 30px 60px rgb(40 25 100 / .16), 0 2px 6px rgb(40 25 100 / .06); transform-origin: 50% 100%; animation: lb-sway 7s ease-in-out infinite; }
  .ttl { font: 600 20px/1.2 var(--font-sans, system-ui); letter-spacing: -.01em; }
  .part { display: grid; gap: 6px; animation: lb-drop 420ms cubic-bezier(.2,.8,.2,1) both; border-radius: 6px; transition: box-shadow 300ms; }
  .part.active { box-shadow: 0 0 0 6px rgb(133 133 253 / .14); }
  .h { display: block; height: 8px; width: 46%; border-radius: 3px; background: #5A3AC1; }
  .part i { display: block; height: 5px; border-radius: 3px; background: #e4e4ec; }
  .lab { font-size: 11.5px; font-weight: 500; color: #5d5d6b; }
  .box { display: block; height: 30px; border: 1.5px solid #c9c6f4; border-radius: 6px; }
  .box[data-file] { height: 46px; border-style: dashed; border-color: #8585fd; background: #f8f7ff; }
  .sig { display: block; height: 30px; border-bottom: 1.5px solid #16161d; width: 60%; }
  .tick { position: absolute; top: 18px; right: 18px; width: 30px; height: 30px; border-radius: 50%; background: var(--ok, #1f9d63); display: grid; place-items: center; }
  .tick svg { width: 18px; height: 18px; fill: none; stroke: #fff; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 24; stroke-dashoffset: 24; animation: lb-draw 420ms cubic-bezier(.2,.8,.2,1) 120ms forwards; }
  @keyframes lb-in { from { opacity: 0; } to { opacity: 1; } }
  @keyframes lb-out { to { opacity: 0; } }
  @keyframes lb-breathe { 50% { opacity: .35; transform: scale(.8); } }
  @keyframes lb-sway { 0%, 100% { transform: rotateX(4deg) rotateY(-3deg); } 50% { transform: rotateX(2deg) rotateY(3deg); } }
  @keyframes lb-drop { from { opacity: 0; transform: translate3d(0, -18px, 40px); } to { opacity: 1; transform: none; } }
  @keyframes lb-draw { to { stroke-dashoffset: 0; } }
  @media (prefers-reduced-motion: reduce) { .lb, .sheet, .part, .dot { animation: none !important; } .lb.done { opacity: 0; transition: opacity 0s 900ms; } .tick svg { animation: none; stroke-dashoffset: 0; } }
  :global(html[data-lite]) .sheet { animation: none; } :global(html[data-lite]) .lb { backdrop-filter: none; }
</style>

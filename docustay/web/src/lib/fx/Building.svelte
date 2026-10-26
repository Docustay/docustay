<script>
  // Run 7 part 8 — THE AI WORKING STATE. Anything AI makes (a draft from words, a form, fields found on a page, a review) shows the thing being built: a sheet whose lines are written one by
  // one and whose fields drop into place, with what is happening in words beside it — never a bare spinner or a percentage. `kind` picks the picture: "document" (lines), "form" (labelled
  // boxes), "fields" (boxes landing on a page). `label` is the sentence; `done`/`total` (optional) move the picture forward with real progress; `finished` plays the finish (the sheet settles
  // and a tick appears) so the result can take its place. Reduced motion: the sheet is shown complete and still, and the words carry the progress.
  import { t } from "$lib/i18n/index.svelte.js";
  let { kind = "document", label = "", done = null, total = null, finished = false, testid = "ai-building" } = $props();
  const rows = $derived(kind === "form" ? 5 : kind === "fields" ? 6 : 7);
  const shown = $derived(total ? Math.max(1, Math.round((done / total) * rows)) : rows);
</script>
<div class="bld" class:fin={finished} role="status" aria-live="polite" data-testid={testid} data-kind={kind}>
  <div class="sheet" aria-hidden="true">
    <i class="hd"></i>
    {#each Array(rows) as _, i}
      {#if kind === "document"}<i class="ln" class:off={i >= shown} style="--i:{i};--w:{[92, 84, 96, 70, 88, 60, 78][i]}%"></i>
      {:else if kind === "form"}<span class="fr" class:off={i >= shown} style="--i:{i}"><i class="lb"></i><i class="bx"></i></span>
      {:else}<i class="ln dim" style="--i:{i};--w:{[90, 76, 94, 82, 68, 88][i]}%"></i>{#if i % 2 === 1}<i class="fd" class:off={i >= shown} style="--i:{i}"></i>{/if}{/if}
    {/each}
    {#if finished}<span class="tick"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.2 4.2L19 7" /></svg></span>{/if}
  </div>
  <p class="msg">{#if finished}{t("Ready")}{:else}<span class="shimmer-text">{label}</span>{/if}{#if total && !finished}<span class="ct">{" "}{t("{done} of {total}", { done, total })}</span>{/if}</p>
</div>
<style>
  .bld { display: flex; align-items: center; gap: 18px; padding: 14px 16px; border: 1px solid var(--line); border-radius: 12px; background: var(--card, var(--tint)); }
  .sheet { position: relative; width: 74px; height: 96px; flex: none; padding: 10px 9px; border-radius: 5px; background: #fff; box-shadow: 0 8px 22px -12px rgb(0 0 0 / .35), 0 0 0 1px rgb(0 0 0 / .06); display: grid; align-content: start; gap: 6px; animation: bld-float 3.2s var(--ease-inout) infinite; }
  .hd { display: block; height: 6px; width: 55%; border-radius: 3px; background: var(--brand, #5a3ac1); opacity: .85; }
  .ln { display: block; height: 3px; width: var(--w); border-radius: 2px; background: #cfc8b8; transform-origin: left; animation: bld-write 1.8s var(--ease-out) calc(var(--i) * 160ms) infinite; }
  .ln.dim { background: #e3ddd0; animation: none; }
  .fr { display: grid; gap: 2px; animation: bld-drop 2.2s var(--ease-out) calc(var(--i) * 220ms) infinite; } .fr .lb { display: block; height: 2px; width: 40%; background: #b9b1a1; border-radius: 1px; } .fr .bx { display: block; height: 7px; border: 1px solid #cfc8b8; border-radius: 2px; }
  .fd { display: block; height: 8px; width: 46%; margin-top: -2px; border: 1.2px dashed var(--brand, #5a3ac1); border-radius: 2px; background: rgb(133 133 253 / .14); animation: bld-drop 2.4s var(--ease-out) calc(var(--i) * 260ms) infinite; }
  .off { opacity: .18; animation: none; }
  .tick { position: absolute; right: -8px; bottom: -8px; width: 26px; height: 26px; border-radius: 50%; background: var(--ok, #0b6a40); display: grid; place-items: center; animation: bld-pop var(--dur-base) var(--ease-out); }
  .tick svg { width: 16px; height: 16px; fill: none; stroke: #fff; stroke-width: 2.6; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 24; stroke-dashoffset: 24; animation: bld-draw var(--dur-slow) var(--ease-out) 80ms forwards; }
  .fin .sheet { animation: none; } .fin .ln, .fin .fr, .fin .fd { animation: none; opacity: 1; }
  .msg { margin: 0; font-size: .92rem; } .ct { margin-left: .3em; color: var(--mute); font-variant-numeric: tabular-nums; }
  @keyframes bld-float { 0%, 100% { transform: translateY(0) rotate(-1.5deg); } 50% { transform: translateY(-3px) rotate(-1deg); } }
  @keyframes bld-write { 0% { transform: scaleX(0); } 45%, 100% { transform: scaleX(1); } }
  @keyframes bld-drop { 0% { transform: translateY(-8px); opacity: 0; } 30%, 100% { transform: none; opacity: 1; } }
  @keyframes bld-pop { from { transform: scale(.4); opacity: 0; } to { transform: none; opacity: 1; } }
  @keyframes bld-draw { to { stroke-dashoffset: 0; } }
  @media (prefers-reduced-motion: reduce) { .sheet, .ln, .fr, .fd, .tick, .tick svg { animation: none !important; } .tick svg { stroke-dashoffset: 0; } .off { opacity: .18; } }
</style>

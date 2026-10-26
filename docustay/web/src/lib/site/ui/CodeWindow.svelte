<script>
  // A code window. EVERY tab's code is in the first HTML (inactive panels are `hidden`, not removed), so crawlers, AI and no-JavaScript visitors read all of it.
  // tabs: [{ label, code }]. Each sample shown on the site was RUN against the sandbox (scripts/snippets-proof.mjs); the response panel shows what came back.
  import { hl } from "./hl.js"; import { track } from "./track.js";
  let { tabs, response = null, responseLabel = "RESPONSE", title = "", label = "Language", tilt = false, page = "", cur = $bindable(0), class: cls = "" } = $props();
  let copied = $state(false);
  const copy = async () => { try { await navigator.clipboard.writeText(tabs[cur].code); copied = true; track("code_copy", { language: tabs[cur].label, page }); setTimeout(() => (copied = false), 1400); } catch { /* clipboard blocked */ } };
  const pick = (i) => { cur = i; track("code_tab_switch", { language: tabs[i].label, page }); };
  const key = (e) => { if (e.key === "ArrowRight") pick((cur + 1) % tabs.length); else if (e.key === "ArrowLeft") pick((cur - 1 + tabs.length) % tabs.length); else return; e.preventDefault(); };
</script>
<div class="cw {cls}" class:tilt data-code data-product-visual="code">
  <div class="bar"><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>{#if title}<span class="ttl">{title}</span>{/if}
    <div class="tabs" role="tablist" aria-label={label} tabindex="-1" onkeydown={key}>{#each tabs as t, i}<button type="button" role="tab" id="cw-{label}-{i}" aria-selected={cur === i} tabindex={cur === i ? 0 : -1} onclick={() => pick(i)}>{t.label}</button>{/each}</div>
    <button type="button" class="cp" onclick={copy} aria-label="Copy the code">{copied ? "Copied" : "Copy"}</button></div>
  {#each tabs as t, i}<!-- svelte-ignore a11y_no_noninteractive_tabindex --><pre role="tabpanel" aria-labelledby="cw-{label}-{i}" hidden={cur !== i} tabindex="0"><code>{@html hl(t.code)}</code></pre>{/each}
  {#if response}<div class="resp"><span>{responseLabel}</span><!-- svelte-ignore a11y_no_noninteractive_tabindex --><pre tabindex="0"><code>{@html hl(response)}</code></pre></div>{/if}
</div>
<style>
  .cw { border-radius: var(--r-4); border: 1px solid var(--ln-2); background: #fff; overflow: hidden; box-shadow: var(--sh-card); text-align: left; min-width: 0; container: codewindow / inline-size; }
  .cw.tilt { transform: perspective(1400px) rotateY(10deg) rotateX(2deg); box-shadow: var(--sh-2); transition: transform var(--d-slow) var(--e-out); } .cw.tilt:hover { transform: none; }
  .bar { display: flex; align-items: center; gap: 12px; padding: 8px 10px 8px 16px; border-bottom: 1px solid var(--ln-1); background: #faf9fe; min-width: 0; }
  .dots { display: inline-flex; gap: 6px; flex: none; } .dots i { width: 9px; height: 9px; border-radius: 50%; background: #dcd8ea; }
  /* R13-D417: in a narrow card (the home page's two columns at 768) the title kept its full width and squeezed the language tabs to 32px; the title now gives way first; in a narrow card it goes and the tabs wrap onto their own row, so every language stays reachable */
  .ttl { font: 12px var(--f-mono); color: var(--tx-3); white-space: nowrap; min-width: 0; overflow: hidden; text-overflow: ellipsis; flex: 0 100 auto; }
  .tabs { display: flex; gap: 2px; margin-left: auto; overflow-x: auto; scrollbar-width: none; min-width: 0; } .tabs button { flex: none; font: 500 12.5px/1 var(--f-mono); color: var(--tx-2); background: none; border: 0; padding: 8px 11px; border-radius: 999px; cursor: pointer; min-height: 32px; } .tabs button[aria-selected="true"] { background: var(--violet-tint); color: var(--v-700); box-shadow: inset 0 0 0 1px rgb(90 58 193 / .28); }
  .cp { flex: none; font: 500 12px var(--f-mono); color: var(--tx-2); background: none; border: 0; padding: 8px 10px; cursor: pointer; border-radius: 8px; } .cp:hover { color: var(--tx-1); }
  pre { margin: 0; padding: 16px 20px 20px; overflow-x: auto; font: 400 13px/1.75 var(--f-mono); color: var(--tx-1); tab-size: 2; max-width: 100%; } pre[hidden] { display: none; }
  pre :global(.k) { color: #5a3ac1; font-style: normal; } pre :global(.s) { color: #1c7448; font-style: normal; } pre :global(.n) { color: #0b6f7a; font-style: normal; } pre :global(.c) { color: #6b6880; font-style: normal; } pre :global(.p) { color: #4c4a5e; }
  .resp { border-top: 1px solid var(--ln-1); } .resp > span { display: block; padding: 10px 20px 0; font: 500 11px var(--f-mono); letter-spacing: .1em; color: var(--tx-3); } .resp pre { padding-top: 6px; }
  @media (max-width: 700px) { .cw.tilt { transform: none; } .ttl { display: none; } }
  @container codewindow (max-width: 520px) { .ttl { display: none; } .bar { flex-wrap: wrap; } .tabs { flex: 1 1 100%; margin-left: 0; flex-wrap: wrap; overflow: visible; } }
  @media (prefers-reduced-motion: reduce) { .cw.tilt, .cw.tilt:hover { transform: none; transition: none; } }
</style>

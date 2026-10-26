<script>
  // THE ONE PRO LOCK (Run 8, the maintainer): every Pro control in the app wears it. When the plan does not include `item`, the control is shown greyed with a lock and a "Pro" tag; pressing anywhere on it
  // gives the lock a small shake and a tip saying what Pro adds, with Explore Pro (the sheet that rises from here, then the pricing page). When the plan includes it, the control is simply itself.
  // Motion board 2, piece 2. Reduced motion: no shake, the tip appears still. The server refuses the item anyway; this lock only says so up front.
  //   Wrap a control: ProLock with item="bulk_send", a tip={t("Send one template to a list of people.")}, and a children snippet that receives `locked` and disables the control by it.
  //   ProLock with item="custom_plays" and badgeOnly — just the lock and the tag, for a label that sits beside a control
  import Icon from "$lib/ui/Icon.svelte";
  import { t } from "$lib/i18n/index.svelte.js";
  import { onMount } from "svelte";
  import { entitled, loadPlan } from "./plan.svelte.js";
  import { exploreProFrom } from "./proSheet.svelte.js";
  let { item, tip = "", badgeOnly = false, quiet = false, locked: force = null, testid = "", class: cls = "", children } = $props();   // quiet: no lock and tag beside the control (a list of many); pressing it still gives the tip
  onMount(() => { loadPlan(); });
  const locked = $derived(force ?? entitled(item) === false);
  let shake = $state(false), showTip = $state(false), tipRight = $state(false), root = $state(null), timer = null;
  function press(e) {
    e?.preventDefault?.(); e?.stopPropagation?.();
    shake = false; setTimeout(() => { shake = true; }, 16);   // not requestAnimationFrame: a window that is not being painted (a hidden pane, a background tab) never runs it, so the lock never shook (R13-D388)
    // R13-D303: a control near the right edge opens its tip leftwards, so the tip is never cut off by the window
    const r = root?.getBoundingClientRect?.(); tipRight = Boolean(r && r.left + Math.min(280, window.innerWidth * 0.8) > window.innerWidth - 8); showTip = true;
    clearTimeout(timer); timer = setTimeout(() => { showTip = false; }, 6000);
  }
  function explore(e) { e.preventDefault(); showTip = false; exploreProFrom(item, root); }
  function key(e) { if (e.key === "Escape" && showTip) { showTip = false; e.stopPropagation(); } }
</script>
<svelte:window onkeydown={key} />
<span class="pl {cls}" class:locked class:badge-only={badgeOnly} bind:this={root} data-testid={testid || `prolock-${item}`} data-locked={locked ? "true" : "false"}>
  {#if !badgeOnly}<span class="pl-body" aria-disabled={locked ? "true" : undefined}>{@render children?.(locked)}</span>{/if}
  {#if locked}
    {#if !badgeOnly}<button type="button" class="pl-cover" aria-label={tip ? `${tip} ${t("Part of Pro.")} ${t("Explore Pro")}` : `${t("Part of Pro.")} ${t("Explore Pro")}`} data-testid="prolock-cover" onclick={press}></button>{/if}
    {#if !quiet}<button type="button" class="pl-tag" class:shake tabindex={badgeOnly ? undefined : -1} data-testid="prolock-tag" aria-label={`${t("Part of Pro.")} ${t("Explore Pro")}`} aria-expanded={showTip} onclick={press} onanimationend={() => (shake = false)}>
      <span class="lk" aria-hidden="true"><Icon name="lock" size={13} /></span><span class="pro">{t("Pro")}</span>
    </button>{/if}
    {#if showTip}
      <span class="pl-tip" class:right={tipRight} role="status" data-testid="prolock-tip">{tip || t("This is part of Docustay Pro.")} <a href="https://docustay.app/pricing#pro" data-testid="prolock-explore" onclick={explore}>{t("Explore Pro")} →</a></span>
    {/if}
  {/if}
</span>
<style>
  .pl { position: relative; display: inline-flex; align-items: center; gap: .5rem; max-width: 100%; }
  .pl-body { min-width: 0; }
  .locked .pl-body { opacity: .55; filter: saturate(.4); pointer-events: none; }
  .pl-cover { position: absolute; inset: 0; z-index: 1; background: transparent; border: 0; padding: 0; cursor: pointer; border-radius: 10px; }
  .pl-cover:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
  .pl-tag { position: relative; z-index: 2; display: inline-flex; align-items: center; gap: 5px; border: 0; background: transparent; padding: 2px; cursor: pointer; font: inherit; min-height: 24px; flex: none; }
  .pl-tag:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; border-radius: 999px; }   /* R13-D163: the tag is one Tab stop only when it stands alone (badgeOnly); beside a control the cover is the stop */
  .lk { display: inline-grid; color: var(--brand, #5a3ac1); transform-origin: 50% 20%; }
  .pro { font-size: 11px; font-weight: 600; line-height: 1; color: color-mix(in srgb, var(--brand) 72%, var(--ink)); background: var(--brand-soft, #efedff); padding: 4px 7px; border-radius: 999px; letter-spacing: .01em; }
  .shake .lk { animation: pl-wig 520ms var(--ease-out, ease-out); }
  .pl-tip { position: absolute; left: 0; top: calc(100% + 8px); z-index: 30; width: min(280px, 80vw); background: var(--ink, #16161d); color: var(--paper, #fff); border-radius: 12px; padding: 11px 13px; font-size: 13px; line-height: 1.45; box-shadow: 0 12px 30px rgb(0 0 0 / .2); animation: pl-tip 180ms var(--ease-out, ease-out); }
  .pl-tip.right { left: auto; right: 0; }
  .pl-tip a { color: #b9b4ff; text-decoration: none; font-weight: 500; white-space: nowrap; }
  .pl-tip a:hover { text-decoration: underline; }
  @keyframes pl-wig { 0% { transform: rotate(0); } 20% { transform: rotate(-12deg); } 40% { transform: rotate(10deg); } 60% { transform: rotate(-6deg); } 80%, 100% { transform: rotate(0); } }
  @keyframes pl-tip { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
  @media (prefers-reduced-motion: reduce) { .shake .lk, .pl-tip { animation: none; } }
  :global(html[data-lite]) .shake .lk { animation-duration: 1ms; }
</style>

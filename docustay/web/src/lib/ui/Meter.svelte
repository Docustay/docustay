<script>
  // A linear meter (Ark Progress, MIT): plan usage, sending health. `tone` colours it; with `auto`, it turns warn at 80% and bad at 100%.
  import { onMount } from "svelte";
  import { Progress } from "@ark-ui/svelte/progress";
  let { value = 0, max = 100, label = "", detail = "", tone = "", auto = false, testid = "" } = $props();
  const pct = $derived(max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0);
  const tn = $derived(tone || (auto ? (pct >= 100 ? "bad" : pct >= 80 ? "warn" : "") : ""));
  // Run 8 (R8-16): the bar refuses a value over its maximum (it threw, and the whole panel went with it) — exactly when a workspace is OVER a limit. The bar fills to the end; the words keep the real number.
  const safeMax = $derived(max > 0 ? max : 1), shown = $derived(Math.min(Math.max(0, Number(value) || 0), safeMax));
  // R8-79 (S9): the 900 ms fill never played — the bar is drawn at its value on its first frame, and the CSS transition only runs on a CHANGE. On first appearance the range grows
  // from its start edge (Web Animations, transform only: no layout, the same in every engine; the CSS @starting-style route flashed a full bar for a frame in Firefox). Later changes
  // still use the width transition in ark.css. Reduced motion and slow devices (html[data-lite]): no fill, the bar is simply there. The value a screen reader gets never changes.
  let wrap = $state(null);
  onMount(() => {
    const r = wrap?.querySelector('[data-part="range"]');
    if (!r || !r.animate || matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.hasAttribute("data-lite")) return;
    const origin = getComputedStyle(r).direction === "rtl" ? "right" : "left";
    r.animate([{ transform: "scaleX(0)", transformOrigin: origin }, { transform: "scaleX(1)", transformOrigin: origin }], { duration: 900, easing: getComputedStyle(document.documentElement).getPropertyValue("--ease-out").trim() || "ease-out" });
  });
</script>
<div class="contents" bind:this={wrap}>
<Progress.Root value={shown} max={safeMax} class="grid gap-1.5" data-testid={testid || undefined}>
  {#if label || detail}<div class="flex items-baseline justify-between text-sm"><Progress.Label class="font-medium">{label}</Progress.Label><span class="text-mute tabular-nums">{detail || `${pct}%`}</span></div>{/if}
  <Progress.Track><Progress.Range data-tone={tn || undefined} /></Progress.Track>
</Progress.Root>
</div>

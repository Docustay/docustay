<script>
  // A white document sheet (always white, never dark). Skeleton lines are only the loading and marketing fallback; real template pages are drawn inside via children.
  let { children, skeleton = false, width = 220, class: cls = "" } = $props();
</script>
<div class="on-paper relative overflow-hidden rounded-md shadow-[0_8px_30px_-10px_rgb(0_0_0/.45)] {cls}" style="width:{width}px;aspect-ratio:8.5/11;background:var(--paper-doc)">{#if children}{@render children()}{:else if skeleton}<div class="grid gap-2 p-5">{#each [60, 90, 80, 90, 40, 85, 70] as w}<i class="block h-1.5 rounded bg-[#e5e3dc]" style="width:{w}%"></i>{/each}<i class="mt-6 block h-px w-1/2 bg-[#15171c]"></i></div>{/if}</div>

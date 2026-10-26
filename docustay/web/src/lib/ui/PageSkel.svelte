<script>
  // Run 7 part 8 — the shape of the page before its data arrives, instead of a blank space or a bare "Loading…": the same height the real content takes (so nothing jumps when it lands),
  // shimmering softly (still under reduced motion). `kind`: list (rows), detail (a heading, a panel and a side column), flow (the step bar and one step), cards (a grid), panel (one block).
  import { t } from "$lib/i18n/index.svelte.js";
  let { kind = "list", rows = 5, testid = "page-loading" } = $props();
</script>
<div class="ps" aria-busy="true" role="status" data-testid={testid} data-kind={kind}>
  <span class="sr-only">{t("Loading…")}</span>
  {#if kind === "list"}
    <div class="grid gap-2">{#each Array(rows) as _, i (i)}<div class="skel h-12" style="opacity:{1 - i * 0.12}"></div>{/each}</div>
  {:else if kind === "detail"}
    <div class="skel h-8 w-1/3"></div>
    <div class="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]"><div class="skel h-[420px]"></div><div class="grid content-start gap-3"><div class="skel h-24"></div><div class="skel h-40"></div></div></div>
  {:else if kind === "flow"}
    <div class="flex gap-2">{#each Array(6) as _, i (i)}<div class="skel h-9 flex-1"></div>{/each}</div>
    <div class="skel mt-5 h-[360px]"></div>
  {:else if kind === "cards"}
    <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{#each Array(rows) as _, i (i)}<div class="skel h-36"></div>{/each}</div>
  {:else}
    <div class="skel h-48"></div>
  {/if}
</div>

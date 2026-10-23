<script>
  // ONE page wrapper with the four page types of the full-width layout system (COMBINED-STYLE-SPEC.md section 8). The page itself never carries a max-width: it fills the main column between the sidebar and the right edge
  // (the shell gives the fluid gutter). Pick the type; put a second column in `aside` when the page has a real one (a live preview, usage, help, the document).
  //   list      a table or rows, 100% wide; the title column flexes
  //   gallery   tiles in `repeat(auto-fill, minmax(168px, 1fr))` so the grid fills any width (tile = the minimum tile width)
  //   split     the main column that flexes + an aside of fixed width (default 22rem); stacks under when the split itself is narrower than 46rem (R13-D292: a container query — the docked assistant and the settings rail take width the viewport does not show)
  //   sections  independent sections flow into as many columns as fit (col = the minimum column width), all sharing the page's edges; a child with class pg-wide takes the full row
  //   paper     the full-width paper ground; put the sheet (PaperSheet) inside it
  import { onMount } from "svelte";
  let { type = "list", aside = null, asideWidth = "22rem", asideLabel = undefined, side = "right", sticky = true, tile = "168px", col = "30rem", row = "1.5rem", gap = "3rem", class: cls = "", testid = undefined, children } = $props();
  // an aside that renders nothing for this person or plan (no billing rights, no cancel button) must not leave an empty column: it is hidden and the main column takes the whole width
  let asideEl = $state(null), solo = $state(false);
  onMount(() => {
    if (!asideEl) return;
    const check = () => { solo = !asideEl.textContent.trim() && !asideEl.querySelector("img, canvas, svg, input, select, textarea, button, a, iframe"); };
    check(); const mo = new MutationObserver(check); mo.observe(asideEl, { childList: true, subtree: true, characterData: true }); return () => mo.disconnect();
  });
</script>
{#if type === "gallery"}<div class="pg-gallery {cls}" style="--tile:{tile}" data-testid={testid}>{@render children()}</div>
{:else if type === "split"}<div class="pg-split-box"><div class="pg-split {side === 'left' ? 'pg-split-left' : ''} {solo ? 'pg-split-solo' : ''} {cls}" style="--aside:{asideWidth}" data-testid={testid}>
  {#if side === "left" && aside}<aside bind:this={asideEl} class="pg-aside {sticky ? 'sticky-aside' : ''} min-w-0" aria-label={asideLabel}>{@render aside()}</aside>{/if}
  <div class="min-w-0">{@render children()}</div>
  {#if side !== "left" && aside}<aside bind:this={asideEl} class="pg-aside {sticky ? 'sticky-aside' : ''} min-w-0" aria-label={asideLabel}>{@render aside()}</aside>{/if}
</div></div>
{:else if type === "sections"}<div class="pg-sections {cls}" style="--col:{col}; --row:{row}; --colgap:{gap}" data-testid={testid}>{@render children()}</div>
{:else if type === "paper"}<div class="pg-paper {cls}" data-testid={testid}>{@render children()}</div>
{:else}<div class="pg-list min-w-0 {cls}" data-testid={testid}>{@render children()}</div>{/if}

<script>
  // Eyebrow, serif title and a lead. `title` may contain ONE accent word written as *word*; it renders as the italic violet <em>. align: "center" or "left".
  let { eyebrow = "", title, lead = "", align = "left", level = 2, id = "", max = 860, class: cls = "" } = $props();
  const parts = $derived(String(title).split(/\*([^*]+)\*/));
</script>
<header class="sh {align} {cls}" style="--mx:{max}px">
  {#if eyebrow}<p class="d-eyebrow">{eyebrow}</p>{/if}
  <svelte:element this={"h" + level} class={level === 1 ? "d-h1" : "d-h2"} {id}>{#each parts as p, i}{#if i % 2}<em>{p}</em>{:else}{p}{/if}{/each}</svelte:element>
  {#if lead}<p class="d-sub">{lead}</p>{/if}
</header>
<style>
  .sh.center { text-align: center; margin-left: auto; margin-right: auto; max-width: var(--mx); } .sh.center :global(.d-sub) { margin-left: auto; margin-right: auto; } .sh.center :global(h1), .sh.center :global(h2) { margin-left: auto; margin-right: auto; }
  .sh :global(.d-h2) { background: var(--grad-title); -webkit-background-clip: text; background-clip: text; color: transparent; } .sh :global(.d-h2 em), .sh :global(.d-h1 em) { background: none; }
</style>

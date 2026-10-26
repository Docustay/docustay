<script>
  // Frame + language tabs + copy + a highlighted line. `tabs`: [{ id, label, html?, code }]: `html` is HTML highlighted at build time (Shiki); without it the code shows as plain text. `highlight`: 1-based line numbers to mark.
  import Frame from "./Frame.svelte";
  import CopyButton from "./CopyButton.svelte";
  import Tabs from "./Tabs.svelte";
  let { tabs = [], title = "", highlight = [], value = $bindable("") } = $props();
  $effect.pre(() => { if (!value && tabs.length) value = tabs[0].id; });
  const cur = $derived(tabs.find((t) => t.id === value) ?? tabs[0]);
  const lines = $derived((cur?.code ?? "").split("\n"));
</script>
<Frame {title}>
  <div class="flex items-center justify-between gap-2 border-b border-line px-3 py-2">{#if tabs.length > 1}<Tabs items={tabs.map((t) => ({ value: t.id, label: t.label }))} bind:value />{:else}<span></span>{/if}<CopyButton value={cur?.code ?? ""} /></div>
  <div class="overflow-x-auto bg-[var(--sidebar)] p-4 font-mono text-[.82rem] leading-6" data-testid="code-window">
    {#if cur?.html}{@html cur.html}{:else}<pre tabindex="0" class="m-0 bg-transparent p-0">{#each lines as l, i}<span class="block {highlight.includes(i + 1) ? '-mx-4 bg-accent-soft px-4' : ''}">{l || " "}</span>{/each}</pre>{/if}
  </div>
</Frame>

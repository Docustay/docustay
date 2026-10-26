<script>
  // A grouped comparison table with a sticky header and check icons. columns: ["Free","Pro"]; groups: [{ title, rows: [{ label, values: [true|false|"text"] }] }]
  import Icon from "$lib/ui/Icon.svelte";
  let { columns = [], groups = [] } = $props();
</script>
<div class="overflow-x-auto rounded-2xl border border-line"><table class="w-full min-w-[34rem] border-collapse text-sm" data-testid="compare-table">
  <thead class="sticky top-0 z-10 bg-card"><tr><th class="p-3 text-left"></th>{#each columns as c}<th scope="col" class="p-3 text-left font-semibold">{c}</th>{/each}</tr></thead>
  {#each groups as g (g.title)}<tbody><tr><th colspan={columns.length + 1} class="border-t border-line bg-tint px-3 py-2 text-left font-mono text-[.7rem] uppercase tracking-wider text-faint">{g.title}</th></tr>
    {#each g.rows as r (r.label)}<tr class="border-t border-line"><th scope="row" class="p-3 text-left font-normal text-text-2">{r.label}</th>{#each r.values as v}<td class="p-3">{#if v === true}<Icon name="check" size={16} class="text-ok" label="Included" />{:else if v === false}<span class="text-faint" aria-label="Not included">—</span>{:else}{v}{/if}</td>{/each}</tr>{/each}</tbody>{/each}
</table></div>

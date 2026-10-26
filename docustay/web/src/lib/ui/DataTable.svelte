<script>
  // A table of hairline rows: sticky header, row hover, an empty state slot, optional row link. columns: [{ key, label, align?, width? }]; rows: objects; draw a cell with the `cell` snippet (row, col).
  let { columns = [], rows = [], rowKey = (r, i) => r.id ?? i, href = null, cell = null, empty = null, caption = "", testid = "" } = $props();
</script>
{#if rows.length === 0 && empty}{@render empty()}{:else}
<div class="dt-wrap overflow-x-auto rounded-xl border border-line bg-card" data-testid={testid || undefined}>
  <table class="dt w-full border-collapse text-sm">
    {#if caption}<caption class="sr-only">{caption}</caption>{/if}
    <thead class="sticky top-0 z-10 bg-card"><tr>{#each columns as c (c.key)}<th scope="col" class="h-9 whitespace-nowrap border-b border-line px-4 text-left font-mono text-[.7rem] font-medium uppercase tracking-wider text-faint" style:text-align={c.align} style:width={c.width}>{c.label}</th>{/each}</tr></thead>
    <tbody>
      {#each rows as r, ri (rowKey(r, ri))}
        <tr class="group h-10 border-b border-line last:border-0 transition-colors hover:bg-tint">
          {#each columns as c, i (c.key)}<td class="px-4 py-2 align-middle" data-label={c.label} style:text-align={c.align}>{#if href && i === 0}<a href={href(r)} class="font-medium no-underline hover:underline">{#if cell}{@render cell(r, c)}{:else}{r[c.key]}{/if}</a>{:else if cell}{@render cell(r, c)}{:else}{r[c.key] ?? ""}{/if}</td>{/each}
        </tr>
      {/each}
    </tbody>
  </table>
</div>{/if}
<style>
  /* On a phone a table of many columns cannot show them all: each row becomes a small card, one labelled line per column, so nothing is hidden behind a scroll box. */
  @media (max-width: 640px) {
    .dt-wrap { overflow-x: visible; }
    .dt thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
    .dt, .dt tbody { display: block; }
    .dt tr { display: block; height: auto; padding: 0.6rem 0.9rem; }
    .dt td { display: flex; justify-content: space-between; align-items: baseline; gap: 0.75rem; padding: 0.2rem 0; text-align: left !important; overflow-wrap: anywhere; }
    .dt td::before { content: attr(data-label); flex: none; max-width: 40%; font-family: var(--font-mono, ui-monospace, monospace); font-size: 0.7rem; letter-spacing: 0.05em; text-transform: uppercase; color: var(--faint); }
    .dt td[data-label=""]::before, .dt td:first-child::before { display: none; }
    .dt td:first-child { font-weight: 500; }
    .dt td:last-child:not(:first-child) { flex-wrap: wrap; justify-content: flex-end; }
  }
</style>

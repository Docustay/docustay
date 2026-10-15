<script>
  // Boxes joined by dashed, blinking connectors; ONE node in red marks where the reader is. nodes: [{ label, sub, red }]. dims numbers the nodes A1, A2 … like dimension lines.
  let { nodes, dims = true, vertical = false, keep = false } = $props();
</script>
<div class="flow {vertical ? 'v' : ''} {keep ? 'keep' : ''} {dims && !vertical ? 'dims' : ''}" role="list">
  {#each nodes as n, i}
    {#if i > 0}<span class="cn" aria-hidden="true"></span>{/if}
    <div class="nd {n.red ? 'red' : ''}" role="listitem">{#if dims && !vertical}<span class="dim" aria-hidden="true">A{i + 1}</span>{/if}<b>{n.label}</b>{#if n.sub}<i>{n.sub}</i>{/if}</div>
  {/each}
</div>

<script>
  // Label / value pairs in a grid, a value can have a copy button. items: [{ label, value, copy?, mono? }]
  import CopyButton from "./CopyButton.svelte";
  import StatusChip from "./StatusChip.svelte";
  let { items = [], cols = 3 } = $props();
</script>
<dl class="grid gap-x-8 gap-y-4 rounded-xl border border-line bg-card p-5" style="grid-template-columns: repeat(auto-fit, minmax(min(100%, {Math.round(720 / cols)}px), 1fr))">
  {#each items as it (it.label)}
    <div class="min-w-0"><dt class="font-mono text-[.7rem] uppercase tracking-wider text-faint">{it.label}</dt><dd class="mt-1 flex items-center gap-1 text-sm {it.mono ? 'font-mono' : ''}">{#if it.tone}<StatusChip tone={it.tone}>{it.value}</StatusChip>{:else}<span class="truncate {it.mono ? 'rounded-md border border-line bg-tint px-1.5 py-0.5 text-[12.5px]' : ''}">{it.value}</span>{/if}{#if it.copy}<CopyButton value={String(it.value)} />{/if}</dd></div>
  {/each}
</dl>

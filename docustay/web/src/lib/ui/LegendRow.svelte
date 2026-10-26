<script>
  // A legend row: coloured dot, name, a right-aligned share. rows: [{ name, color, value, share? }]
  let { rows = [] } = $props();
</script>
<ul class="grid gap-1.5 text-sm">{#each rows as r (r.name)}<li class="flex items-center gap-2"><span class="h-2.5 w-2.5 shrink-0 rounded-full" style="background:{r.color}"></span><span class="min-w-0 flex-1 truncate">{r.name}</span><span class="font-mono tabular-nums text-mute">{r.share ?? r.value}</span></li>{/each}</ul>

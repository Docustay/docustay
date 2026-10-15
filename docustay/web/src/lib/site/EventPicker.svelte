<script>
  // Event cards that swap a payload: pick an event, see its JSON. events: [{ id, label, line?, payload }]
  import CodeWindow from "$lib/ui/CodeWindow.svelte";
  let { events = [], value = $bindable("") } = $props();
  $effect.pre(() => { if (!value && events.length) value = events[0].id; });
  const cur = $derived(events.find((e) => e.id === value) ?? events[0]);
</script>
<div class="grid gap-4 md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]" data-testid="event-picker">
  <div class="grid content-start gap-2" role="tablist" aria-label="Events">{#each events as e (e.id)}<button type="button" role="tab" aria-selected={value === e.id} class="press glow-hover rounded-xl border p-3 text-left {value === e.id ? 'border-[var(--accent-line)] bg-accent-soft' : 'border-line bg-card'}" onclick={() => (value = e.id)}><div class="font-mono text-sm">{e.label}</div>{#if e.line}<div class="text-xs text-mute">{e.line}</div>{/if}</button>{/each}</div>
  {#if cur}<CodeWindow title={cur.label} tabs={[{ id: "json", label: "JSON", code: JSON.stringify(cur.payload, null, 2) }]} />{/if}
</div>

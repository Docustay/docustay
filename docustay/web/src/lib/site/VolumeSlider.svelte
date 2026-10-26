<script>
  // "How many documents a month?": a slider with ticks and a live estimate. `steps`: [{ value, label }] ticks; `estimate(value)` returns the text to show.
  import Range from "$lib/ui/Range.svelte";
  let { steps = [], value = $bindable(0), estimate = (v) => String(v), label = "" } = $props();
  const min = $derived(steps[0]?.value ?? 0), max = $derived(steps.at(-1)?.value ?? 100);
</script>
<div class="rounded-2xl border border-line bg-card p-5" data-testid="volume-slider"><Range bind:value {min} {max} {label} marks={steps} format={(v) => v.toLocaleString()} /><p class="mt-4 text-sm text-mute" role="status">{estimate(value)}</p></div>

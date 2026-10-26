<script>
  // A slider (Ark Slider, MIT): the pricing estimate. `marks` draws labelled ticks. `value` is a number, bindable.
  import { Slider } from "@ark-ui/svelte/slider";
  let { value = $bindable(0), min = 0, max = 100, step = 1, marks = [], label = "", format = (v) => String(v), onchange = () => {}, testid = "" } = $props();
</script>
<Slider.Root value={[value]} {min} {max} {step} onValueChange={(d) => { value = d.value[0]; onchange(d.value[0]); }} class="grid gap-2" data-testid={testid || undefined}>
  {#if label}<div class="flex items-baseline justify-between text-sm"><Slider.Label class="font-medium">{label}</Slider.Label><output class="font-mono text-ink tabular-nums">{format(value)}</output></div>{/if}
  <Slider.Control>
    <Slider.Track><Slider.Range /></Slider.Track>
    <Slider.Thumb index={0}><Slider.HiddenInput /></Slider.Thumb>
  </Slider.Control>
  {#if marks.length}<Slider.MarkerGroup class="relative h-6">{#each marks as m (m.value)}<Slider.Marker value={m.value} class="text-xs text-faint"><span class="block -translate-x-1/2 pt-1">{m.label}</span></Slider.Marker>{/each}</Slider.MarkerGroup>{/if}
</Slider.Root>

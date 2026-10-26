<script>
  // A segmented choice (Ark Segment Group, MIT): Board / List, Desktop / Phone, One after another / All at once. options: [{ value, label, icon? }].
  import { SegmentGroup } from "@ark-ui/svelte/segment-group";
  import Icon from "./Icon.svelte";
  let { options = [], value = $bindable(""), onchange = () => {}, label = "", testid = "", class: cls = "" } = $props();
</script>
<SegmentGroup.Root value={String(value)} onValueChange={(d) => { value = d.value; onchange(d.value); }} aria-label={label || undefined} class={cls} data-testid={testid || undefined}>
  <SegmentGroup.Indicator />
  {#each options as o (o.value)}
    <SegmentGroup.Item value={String(o.value)} data-testid={testid ? `${testid}-${o.value}` : undefined}>
      <SegmentGroup.ItemText>{#if o.icon}<Icon name={o.icon} size={15} />{/if}{o.label}</SegmentGroup.ItemText>
      <SegmentGroup.ItemControl />
      <SegmentGroup.ItemHiddenInput />
    </SegmentGroup.Item>
  {/each}
</SegmentGroup.Root>

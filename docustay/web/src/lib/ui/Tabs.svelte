<script>
  // Tabs (Ark Tabs, MIT) with a sliding pill. items: [{ value, label, icon?, count? }] (count: a number in text 3 after the label). Give a `panel` snippet to draw each panel: {#snippet panel(value)}…{/snippet}. Without one (tabs used as a filter) the empty panel is not a Tab stop.
  import { Tabs } from "@ark-ui/svelte/tabs";
  import Icon from "./Icon.svelte";
  let { items = [], value = $bindable(""), onchange = () => {}, panel = null, label = "", testid = "", idPrefix = "", class: cls = "" } = $props();
  $effect.pre(() => { if (!value && items.length) value = items[0].value; });
</script>
<Tabs.Root {value} onValueChange={(d) => { value = d.value; onchange(d.value); }} class={cls} data-testid={testid || undefined}>
  <Tabs.List aria-label={label || undefined}>
    {#each items as it (it.value)}<Tabs.Trigger value={it.value} data-testid={idPrefix || testid ? `${idPrefix || testid}-${it.value}` : undefined}>{#if it.icon}<Icon name={it.icon} size={14} class="mr-1.5 align-[-2px]" />{/if}{it.label}{#if it.count != null}<span class="tab-count">{it.count}</span>{/if}</Tabs.Trigger>{/each}
    <Tabs.Indicator />
  </Tabs.List>
  {#each items as it (it.value)}<Tabs.Content value={it.value} tabindex={panel ? 0 : -1}>{#if panel}{@render panel(it.value)}{/if}</Tabs.Content>{/each}
</Tabs.Root>

<script>
  // A PICKER for a finite set of choices (Ark UI Select, MIT): never a typed box. options: [{ value, label, icon?, hint?, dot? }]. `onchange(value)` fires on a pick.
  // Native look on phones is kept by Ark's own positioning; the trigger is a 40px button.
  import { Select, createListCollection } from "@ark-ui/svelte/select";
  import { Portal } from "@ark-ui/svelte/portal";
  import FlowIcon from "$lib/flow/FlowIcon.svelte";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import Check from "@lucide/svelte/icons/check";
  let { id = "", options = [], value = "", onchange = () => {}, label = "", placeholder = "", testid = "", disabled = false, class: cls = "" } = $props();
  const collection = $derived(createListCollection({ items: options, itemToValue: (o) => String(o.value), itemToString: (o) => o.label }));
  const current = $derived(options.find((o) => String(o.value) === String(value)));
</script>
<Select.Root {collection} ids={id ? { trigger: id } : undefined} value={value === "" || value == null ? [] : [String(value)]} onValueChange={(d) => { const v = d.value[0]; if (v !== undefined) onchange(options.find((o) => String(o.value) === v)?.value ?? v); }} {disabled} positioning={{ sameWidth: true }} lazyMount unmountOnExit class="pick {cls}">
  {#if label}<Select.Label class="pick-label">{label}</Select.Label>{/if}
  <Select.Control>
    <Select.Trigger class="pick-trigger" data-testid={testid || undefined}>
      {#if current?.dot}<span class="dot" style="background:{current.dot}"></span>{/if}
      {#if current?.icon}<FlowIcon name={current.icon} size={16} />{/if}
      <span class="pick-value">{current ? current.label : placeholder}</span>
      <ChevronDown size={16} aria-hidden="true" />
    </Select.Trigger>
  </Select.Control>
  <Portal>
    <Select.Positioner>
      <Select.Content class="pick-content">
        {#each options as o (o.value)}
          <Select.Item item={o} class="pick-item" data-testid={testid ? `${testid}-${o.value}` : undefined}>
            {#if o.dot}<span class="dot" style="background:{o.dot}"></span>{/if}
            {#if o.icon}<FlowIcon name={o.icon} size={16} />{/if}
            <Select.ItemText>{o.label}</Select.ItemText>
            {#if o.hint}<span class="hint">{o.hint}</span>{/if}
            <Select.ItemIndicator><Check size={14} /></Select.ItemIndicator>
          </Select.Item>
        {/each}
      </Select.Content>
    </Select.Positioner>
  </Portal>
  <Select.HiddenSelect />
</Select.Root>
<style>
  :global(.pick) { display: block; min-width: 0; }
  :global(.pick-label) { display: block; font-size: 13px; color: var(--mute); margin-bottom: 4px; }
  :global(.pick-trigger) { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 40px; padding: 0 12px; border: 1px solid var(--line-strong); border-radius: 10px; background: var(--card); color: var(--ink); font: inherit; text-align: left; cursor: pointer; }
  :global(.pick-trigger[data-disabled]) { opacity: .5; cursor: not-allowed; }
  :global(.pick-trigger:focus-visible) { outline: 2px solid #5b3ad6; outline-offset: 1px; }
  :global(.pick-value) { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  :global([data-scope="select"][data-part="positioner"]) { z-index: 120 !important; }
  :global(.pick-content) { background: var(--card); border: 1px solid var(--line-strong); border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,.14); padding: 4px; max-height: 320px; overflow: auto; z-index: 120; }
  :global(.pick-item) { display: flex; align-items: center; gap: 8px; min-height: 40px; padding: 0 10px; border-radius: 8px; cursor: pointer; color: var(--ink); }
  :global(.pick-item[data-highlighted]) { background: var(--tint); }
  :global(.pick-item[data-state="checked"]) { font-weight: 600; }
  :global(.pick-item .hint) { margin-left: auto; font-size: 12px; color: var(--mute); }
  .dot { width: 10px; height: 10px; border-radius: 50%; flex: none; }
</style>

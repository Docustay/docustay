<script>
  // Pick SEVERAL from a fixed list (Ark UI Combobox, multiple, MIT), optionally "add your own". options: [{ value, label, hint? }]. Chosen values show as chips you can remove.
  import { Combobox, createListCollection } from "@ark-ui/svelte/combobox";
  import { Portal } from "@ark-ui/svelte/portal";
  import Check from "@lucide/svelte/icons/check";
  import X from "@lucide/svelte/icons/x";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import { t } from "$lib/i18n/index.svelte.js";
  let { options = [], value = $bindable([]), onchange = () => {}, allowCustom = false, label = "", placeholder = "", testid = "", id = "", disabled = false, mono = false } = $props();
  let query = $state("");
  const known = $derived(new Map(options.map((o) => [String(o.value), o])));
  const shown = $derived(options.filter((o) => !query.trim() || `${o.label} ${o.value}`.toLowerCase().includes(query.trim().toLowerCase())));
  const collection = $derived(createListCollection({ items: shown, itemToValue: (o) => String(o.value), itemToString: (o) => o.label }));
  const setv = (next) => { const clean = [...new Set(next)]; value = clean; onchange(clean); };
  const custom = $derived(allowCustom && query.trim() && !known.has(query.trim()) ? query.trim() : null);
  const nameOf = (v) => known.get(String(v))?.label ?? v;
</script>
<Combobox.Root {collection} multiple value={value.map(String)} onValueChange={(d) => setv(d.value)} inputValue={query} onInputValueChange={(d) => (query = d.inputValue)} openOnClick closeOnSelect={false} {disabled} class="choicemulti" data-testid={testid || undefined}>
  {#if label}<Combobox.Label class="label">{label}</Combobox.Label>{/if}
  <Combobox.Control class="chips-control">
    {#each value as v (v)}
      <span class="chip" data-testid={testid ? `${testid}-chip` : undefined}><span class="chip-body"><span class={mono ? "mono" : ""}>{nameOf(v)}</span><button type="button" class="chip-x" aria-label={t("Remove {value}", { value: nameOf(v) })} onclick={() => setv(value.filter((x) => x !== v))}><X size={14} /></button></span></span>
    {/each}
    <Combobox.Input {id} class="chips-input {mono ? 'mono' : ''}" placeholder={value.length ? "" : placeholder} data-testid={testid ? `${testid}-input` : undefined}
      onkeydown={(e) => { if (e.key === "Enter" && custom) { e.preventDefault(); e.stopPropagation(); setv([...value, custom]); query = ""; } else if (e.key === "Backspace" && !query && value.length) setv(value.slice(0, -1)); }} />
    <Combobox.Trigger class="chip-x" aria-label={t("Show choices")}><ChevronDown size={16} /></Combobox.Trigger>
  </Combobox.Control>
  <Portal>
    <Combobox.Positioner>
      <Combobox.Content>
        {#each shown as o (o.value)}
          <Combobox.Item item={o}><Combobox.ItemText>{o.label}{#if o.hint}<span class="text-xs text-mute"> · {o.hint}</span>{/if}</Combobox.ItemText><Combobox.ItemIndicator><Check size={15} /></Combobox.ItemIndicator></Combobox.Item>
        {/each}
        {#if custom}<button type="button" class="w-full px-3 py-2 text-left text-sm" onclick={() => { setv([...value, custom]); query = ""; }}>{t("Add “{value}”", { value: custom })}</button>{/if}
        {#if !shown.length && !custom}<div class="px-3 py-2 text-sm text-mute">{t("Nothing matches.")}</div>{/if}
      </Combobox.Content>
    </Combobox.Positioner>
  </Portal>
</Combobox.Root>

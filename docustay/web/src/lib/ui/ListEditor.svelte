<script>
  // A list of lines, one input per item, with add, remove and move up or down (all keyboard reachable). For free sentences that are too long for chips, like a play's checklist.
  import Plus from "@lucide/svelte/icons/plus";
  import X from "@lucide/svelte/icons/x";
  import ChevronUp from "@lucide/svelte/icons/chevron-up";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import { t } from "$lib/i18n/index.svelte.js";
  let { value = $bindable([]), onchange = () => {}, label = "", placeholder = "", addLabel = "", max = 50, testid = "", maxlength = 300 } = $props();
  const keys = $derived(value.map((_, i) => i));
  const set = (next) => { value = next; onchange(next); };
  const edit = (i, v) => set(value.map((x, k) => (k === i ? v : x)));
  const move = (i, d) => { const j = i + d; if (j < 0 || j >= value.length) return; const n = [...value]; [n[i], n[j]] = [n[j], n[i]]; set(n); };
  async function add() { if (value.length >= max) return; set([...value, ""]); await Promise.resolve(); setTimeout(() => document.querySelector(`[data-testid="${testid}-row"]:last-of-type input`)?.focus(), 0); }
</script>
<div class="listed" data-testid={testid || undefined}>
  {#if label}<span class="label">{label}</span>{/if}
  <ol class="grid gap-2">
    {#each keys as i (i)}
      <li class="listed-row" data-testid={testid ? `${testid}-row` : undefined}>
        <span class="listed-n mono" aria-hidden="true">{i + 1}</span>
        <input class="field grow" value={value[i]} {maxlength} {placeholder} aria-label={t("Item {n}", { n: i + 1 })} oninput={(e) => edit(i, e.currentTarget.value)}
          onkeydown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } else if (e.key === "Backspace" && !value[i]) { e.preventDefault(); set(value.filter((_, k) => k !== i)); } }} />
        <button type="button" class="chip-x listed-btn" aria-label={t("Move up")} disabled={i === 0} onclick={() => move(i, -1)}><ChevronUp size={16} /></button>
        <button type="button" class="chip-x listed-btn" aria-label={t("Move down")} disabled={i === value.length - 1} onclick={() => move(i, 1)}><ChevronDown size={16} /></button>
        <button type="button" class="chip-x listed-btn" aria-label={t("Remove item {n}", { n: i + 1 })} onclick={() => set(value.filter((_, k) => k !== i))}><X size={16} /></button>
      </li>
    {/each}
  </ol>
  <button type="button" class="btn quiet mt-2" disabled={value.length >= max} onclick={add} data-testid={testid ? `${testid}-add` : undefined}><Plus size={15} />{addLabel || t("Add an item")}</button>
</div>

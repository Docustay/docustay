<script>
  // The "+" under the last card (board "Automation"): it sits on the canvas, so it moves with the cards; its menu lists the steps an automation can take.
  import { Handle, Position } from "@xyflow/svelte";
  import { t } from "$lib/i18n/index.svelte.js";
  let { data } = $props();
</script>
<div class="addn nodrag nopan">
  <Handle type="target" position={Position.Top} isConnectable={false} class="hd" />
  <button class="add" aria-label={t("Add a step")} aria-expanded={data.open} onclick={(e) => { e.stopPropagation(); data.ontoggle(); }} data-testid="automation-add">+</button>
  {#if data.open}<div class="menu" role="menu" data-testid="automation-add-menu">{#each data.kinds as k}<button role="menuitem" onclick={(e) => { e.stopPropagation(); data.onadd(k.kind); }} data-testid={`automation-add-${k.kind}`}>{k.label}</button>{/each}</div>{/if}
</div>
<style>
  .addn { width: 340px; display: flex; flex-direction: column; align-items: center; gap: 8px; cursor: default; }
  .add { width: 40px; height: 40px; border-radius: 50%; border: 1.5px dashed #8585fd; background: var(--card); color: var(--brand); font-size: 20px; cursor: pointer; }
  .add:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
  .menu { display: grid; background: var(--card); border: 1px solid var(--line); border-radius: 12px; box-shadow: 0 12px 30px rgba(40, 25, 100, .14); padding: 6px; min-width: 15rem; }
  .menu button { text-align: left; padding: 8px 10px; border-radius: 8px; font-size: 14px; color: var(--ink); } .menu button:hover, .menu button:focus-visible { background: var(--tint, var(--panel)); }
  .addn :global(.hd) { opacity: 0; width: 6px; height: 6px; min-width: 0; min-height: 0; border: 0; pointer-events: none; }
</style>

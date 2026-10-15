<script>
  // The field palette: ONE compact column grouped Sign, Fill in, Choose, More (and, for a written document, merge text). It scrolls on its own, so it never makes the page taller than the screen.
  // A tile is dragged onto the document or clicked once.
  import { t } from "$lib/i18n/index.svelte.js";
  import { tl } from "./flowLabels.js";
  import { FIELD_TYPES } from "./flowDefinition.js";
  import { PALETTE, SMART } from "./palette.js";
  import FlowIcon from "./FlowIcon.svelte";
  let { onadd = () => {}, ondragstart = () => {}, onmerge = null, merges = [], prefix = "pp-tile", available = null, hint = "", armed = null } = $props();
  const name = (id) => ({ smart_name: t("Name"), smart_email: t("Email"), company: t("Company"), title: t("Title") })[id] ?? tl(FIELD_TYPES.find((f) => f.id === id)?.label ?? id);
  const icon = (id) => SMART[id]?.icon ?? FIELD_TYPES.find((f) => f.id === id)?.icon ?? "text-cursor-input";
  const group = (id) => ({ sign: t("Sign"), fill: t("Fill in"), choose: t("Choose"), more: t("More") })[id];
</script>
<nav class="palette" aria-label={t("Fields")}>
  {#each PALETTE as g (g.id)}
    <p class="palette-h">{group(g.id)}</p>
    {#each g.ids.filter((id) => !available || available(id)) as id (id)}
      <button type="button" draggable="true" class="palette-row" ondragstart={(e) => ondragstart(e, id)} onclick={(e) => onadd(id, e)} aria-pressed={armed === null ? undefined : armed === id} class:armed={armed === id} data-testid={`${prefix}-${id}`} title={hint}><FlowIcon name={icon(id)} size={16} /><span>{name(id)}</span></button>
    {/each}
  {/each}
  {#if onmerge}
    <p class="palette-h">{t("Merge text")}</p>
    {#each merges as m (m.name)}<button type="button" class="palette-row" onmousedown={(e) => e.preventDefault()} onclick={() => onmerge(m)} data-testid={`${prefix}-merge-${m.name.replace(/[^a-z0-9_]+/g, "-")}`}><FlowIcon name="user" size={16} /><span>{m.label}</span></button>{/each}
  {/if}
</nav>
<style>
  .palette { display: flex; flex-direction: column; gap: 2px; max-height: calc(100vh - 11rem); min-height: 12rem; overflow-y: auto; padding-right: 4px; }
  .palette-h { margin: 10px 0 2px; font-size: .7rem; letter-spacing: .06em; text-transform: uppercase; color: var(--mute, #6b7280); }
  .palette-h:first-child { margin-top: 0; }
  .palette-row { display: flex; align-items: center; gap: 8px; min-height: 36px; padding: 0 10px; border: 1px solid transparent; border-radius: 8px; background: transparent; font-size: .875rem; text-align: left; cursor: grab; }
  .palette-row:hover { background: var(--tint, #f3efe6); border-color: var(--line, #ddd6c5); }
  .palette-row:active { cursor: grabbing; }
  .palette-row.armed { background: var(--tint, #f3efe6); border-color: var(--brand, #333); font-weight: 600; }
  @media (max-width: 1023px) {
    .palette { flex-direction: row; max-height: none; min-height: 0; overflow-x: auto; overflow-y: hidden; gap: 6px; padding: 0 0 6px; }
    .palette-h { display: none; }
    .palette-row { flex: none; border-color: var(--line, #ddd6c5); background: var(--card, #fff); white-space: nowrap; }
  }
</style>

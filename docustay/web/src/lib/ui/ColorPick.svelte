<script>
  // A colour is picked, never typed: a row of swatches, the system colour picker for anything else, and "Use the standard colour" to clear it. Saves a six-digit #hex (or null for the standard colour).
  import { t } from "$lib/i18n/index.svelte.js";
  let { value = null, onchange = () => {}, id = "", presets = ["#1f2937", "#4f46e5", "#2563eb", "#0891b2", "#059669", "#d97706", "#dc2626", "#7c3aed", "#000000"], testid = "" } = $props();
  const on = (c) => String(value ?? "").toLowerCase() === c;
</script>
<div class="flex flex-wrap items-center gap-2" data-testid={testid || undefined}>
  {#each presets as c}<button type="button" class="swatch" class:on={on(c)} style:background={c} aria-label={c} aria-pressed={on(c)} onclick={() => onchange(c)}></button>{/each}
  <label class="swatch custom" aria-label={t("Pick another colour")} title={t("Pick another colour")}><input {id} type="color" value={/^#[0-9a-f]{6}$/i.test(value ?? "") ? value : "#4f46e5"} onchange={(e) => onchange(e.currentTarget.value)} /></label>
  <span class="mono text-xs text-mute">{value ?? t("Standard colour")}</span>
  {#if value}<button type="button" class="btn quiet !min-h-8 !px-2 text-xs" onclick={() => onchange(null)}>{t("Use the standard colour")}</button>{/if}
</div>
<style>
  .swatch { width: 2rem; height: 2rem; border-radius: .5rem; border: 1px solid var(--line-strong); cursor: pointer; padding: 0; position: relative; overflow: hidden; }
  .swatch.on { outline: 3px solid var(--accent); outline-offset: 1px; border-color: var(--brand); }
  .swatch.custom { background: conic-gradient(red, yellow, lime, aqua, blue, magenta, red); }
  .swatch input { position: absolute; inset: 0; opacity: 0; width: 100%; height: 100%; cursor: pointer; }
  @media (pointer: coarse), (max-width: 640px) { .swatch { width: 2.75rem; height: 2.75rem; } }
</style>

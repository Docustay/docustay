<script>
  // THE LAYOUT SWITCHER (Run 8, the maintainer): top left of the Scribe panel in every layout, used like a browser's own window controls — four small marks, one press changes the layout on the spot.
  // A quiet column · B floating sheet · C live build · D command bar. Nothing is saved: the panel always opens in A. Hidden on a phone (one full-screen sheet). Arrow keys move along it.
  import { t } from "$lib/i18n/index.svelte.js";
  let { value = "A", onchange = () => {}, dark = false } = $props();
  const ITEMS = $derived([["A", t("Docked column")], ["B", t("Floating sheet")], ["C", t("Live build")], ["D", t("Command bar")]]);
  function key(e) {
    const i = ITEMS.findIndex(([k]) => k === value), d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0; if (!d) return;
    e.preventDefault(); const n = ITEMS[(i + d + ITEMS.length) % ITEMS.length][0]; onchange(n); requestAnimationFrame(() => e.currentTarget?.querySelector?.(`[data-layout="${n}"]`)?.focus());
  }
</script>
<div class="ls" class:dark role="radiogroup" aria-label={t("Panel layout")} tabindex="-1" data-testid="chat-layout-switch" onkeydown={key}>
  {#each ITEMS as [k, label] (k)}
    <button type="button" role="radio" aria-checked={value === k} aria-label={label} title={label} tabindex={value === k ? 0 : -1} class:on={value === k} data-layout={k} data-testid={`chat-layout-${k}`} onclick={() => onchange(k)}>
      <svg viewBox="0 0 16 12" aria-hidden="true">
        {#if k === "A"}<rect x=".75" y=".75" width="14.5" height="10.5" rx="2" /><path d="M10 1v10" /><path class="f" d="M10.6 1.4h4v9.2h-4z" />
        {:else if k === "B"}<rect x=".75" y=".75" width="14.5" height="10.5" rx="2" /><rect class="f" x="8.5" y="4.5" width="5.5" height="5.5" rx="1.2" />
        {:else if k === "C"}<rect x=".75" y=".75" width="14.5" height="10.5" rx="2" /><rect class="f" x="3" y="3" width="5" height="6.5" rx=".8" /><path d="M11 1v10" />
        {:else}<rect x=".75" y=".75" width="14.5" height="10.5" rx="2" /><rect class="f" x="3.5" y="7.5" width="9" height="2.6" rx="1.2" />{/if}
      </svg>
    </button>
  {/each}
</div>
<style>
  .ls { display: inline-flex; gap: 2px; padding: 2px; border-radius: 8px; background: var(--tint); flex: none; }
  .ls.dark { background: rgb(255 255 255 / .08); }
  button { width: 26px; height: 22px; display: inline-grid; place-items: center; border: 0; border-radius: 6px; background: transparent; color: var(--mute); cursor: pointer; padding: 0; transition: background var(--dur-fast, 160ms) var(--ease-out, ease-out), color var(--dur-fast, 160ms); }
  button:hover { color: var(--ink); }
  button.on { background: var(--card); color: var(--brand); box-shadow: 0 1px 2px rgb(0 0 0 / .08); }
  .dark button.on { background: rgb(255 255 255 / .16); color: #fff; }
  button:focus-visible { outline: 2px solid var(--brand); outline-offset: 1px; }
  svg { width: 16px; height: 12px; fill: none; stroke: currentColor; stroke-width: 1.2; }
  svg .f { fill: currentColor; stroke: none; opacity: .85; }
  @media (prefers-reduced-motion: reduce) { button { transition: none; } }
</style>

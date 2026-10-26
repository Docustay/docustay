<script>
  // Settings → Appearance (frame 11): three 120px preview cards: Light (the default), Dark, System (half and half). One choice, remembered on this device and in the cookie the server reads before paint.
  import { theme } from "$lib/theme/theme.svelte.js";
  import Icon from "./Icon.svelte";
  import { t } from "$lib/i18n/index.svelte.js";
  const OPTIONS = $derived([["light", t("Light"), t("Default")], ["dark", t("Dark"), ""], ["system", t("System"), t("Follows your device")]]);
</script>
<section class="card p-5" data-testid="theme-cards" aria-labelledby="theme-h">
  <h2 id="theme-h" class="text-[15px] font-medium">{t("Theme")}</h2><p class="mt-1 text-sm text-mute">{t("How Docustay looks to you. This applies to the app and the docs on this device; the signing page and the emails stay light.")}</p>
  <div class="mt-4 flex flex-wrap items-start gap-4" role="radiogroup" aria-label={t("Theme")}>
    {#each OPTIONS as [v, label, hint]}
      <button type="button" role="radio" aria-checked={theme.preference === v} class="tcard w-[120px] text-left {theme.preference === v ? 'on' : ''}" onclick={() => theme.set(v)} data-testid="theme-{v}">
        <span class="prev block h-[76px] overflow-hidden rounded-[10px] border border-line-strong" aria-hidden="true">
          {#if v === "system"}<span class="grid h-full grid-cols-2"><span class="mini light"><i></i><i></i><i></i></span><span class="mini dark"><i></i><i></i><i></i></span></span>{:else}<span class="mini {v} block h-full"><i></i><i></i><i></i></span>{/if}
        </span>
        <span class="mt-2 flex items-center gap-1.5 text-[13.5px] font-medium">{label}{#if theme.preference === v}<Icon name="check" size={14} class="text-[var(--accent)]" />{/if}</span>
        {#if hint}<span class="text-[12px] text-mute">{hint}</span>{/if}
      </button>
    {/each}
  </div>
</section>
<style>
  .tcard { border: 1.5px solid transparent; border-radius: 14px; padding: 6px; background: none; cursor: pointer; } .tcard:hover { background: var(--tint); } .tcard.on { border-color: var(--accent); background: var(--accent-soft); }
  .mini { display: grid; gap: 5px; padding: 10px; align-content: start; } .mini i { display: block; height: 6px; border-radius: 99px; } .mini i:first-child { width: 55%; height: 8px; }
  .mini.light { background: #fdfdfd; } .mini.light i { background: #d8d8dc; } .mini.light i:first-child { background: #191919; }
  .mini.dark { background: #08090c; } .mini.dark i { background: #2a2e3a; } .mini.dark i:first-child { background: #e6e9ef; }
</style>

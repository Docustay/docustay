<script>
  // The Scribe prompt box: 10px corners, 15px text, a bottom row with Attach a file, Use a template instead, a time hint and the one primary "Draft it".
  import { t } from "$lib/i18n/index.svelte.js";
  import Icon from "./Icon.svelte";
  let { value = $bindable(""), placeholder = "", busy = false, hint = "", onsubmit = () => {}, onattach = null, ontemplate = null, ctaLabel = "", testid = "scribe-prompt", class: cls = "" } = $props();
  const go = () => { if (!busy && value.trim()) onsubmit(value.trim()); };
</script>
<div class="rounded-[10px] border border-line-strong bg-card focus-within:border-brand {cls}">
  <textarea class="block w-full resize-none rounded-t-[10px] border-0 bg-transparent px-4 pt-3.5 text-[15px] leading-relaxed text-ink outline-none placeholder:text-faint" rows="3" bind:value placeholder={placeholder || t("What do you need signed?")} aria-label={t("Describe the document")} data-testid={testid} onkeydown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); go(); } }}></textarea>
  <div class="flex flex-wrap items-center gap-2 px-3 pb-2.5 pt-1">
    {#if onattach}<button type="button" class="btn quiet" onclick={onattach} data-testid="scribe-attach"><Icon name="upload" size={14} />{t("Attach a file")}</button>{/if}
    {#if ontemplate}<button type="button" class="btn quiet" onclick={ontemplate} data-testid="scribe-template">{t("Use a template instead")}</button>{/if}
    <span class="ml-auto text-[12px] text-faint">{hint}</span>
    <button type="button" class="btn primary final" disabled={busy || !value.trim()} onclick={go} data-testid="scribe-go">{ctaLabel || t("Draft it")}</button>
  </div>
</div>

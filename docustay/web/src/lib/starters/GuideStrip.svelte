<script>
  // A short strip above the editor for a document that was just made from a ready-made template: what is already done, and the three things left. Dismissible; shown once per document.
  import { page } from "$app/state";
  import { t } from "$lib/i18n/index.svelte.js";
  let { step = "people", onstep = () => {} } = $props();
  const q = page.url.searchParams, on = q.get("from") === "starter";
  const key = `docustay-guide-${page.params.id}`;
  let gone = $state((() => { try { return sessionStorage.getItem(key) === "1"; } catch { return false; } })());
  const dismiss = () => { gone = true; try { sessionStorage.setItem(key, "1"); } catch { /* ignore */ } };
  const title = q.get("title") ?? "", reused = q.get("reused") === "1", waiting = q.get("file") === "1";
  const steps = $derived([["people", t("Add the signers")], ["prepare", t("Check the fields")], ["send", t("Send")]]);
</script>
{#if on && !gone}
  <div class="mb-5 rounded-xl border border-info-line bg-info-bg p-4 text-sm" data-testid="guide-strip" role="region" aria-label={t("Getting started with this template")}>
    <div class="flex items-start gap-3"><div class="min-w-0 flex-1">
      <p class="font-semibold text-info">{title ? t("“{title}” is ready.", { title }) : t("Your template is ready.")}</p>
      <p class="mt-0.5 text-ink/80">{t("The text and the fields are already in place. Three things are left:")}{reused ? " " + t("You already had this template in your workspace, so this document starts from that copy.") : ""}</p>
      <ol class="mt-2 flex flex-wrap gap-2">{#each steps as [k, label], i}<li><button type="button" class="rounded-full border px-3 py-1 text-xs {step === k ? 'border-info bg-card font-semibold' : 'border-info-line bg-card/60'}" onclick={() => onstep(k)}>{i + 1}. {label}</button></li>{/each}</ol>
      <p class="mt-2 text-xs text-mute">{t("This template is a starting point written in plain words, not legal advice. Read it through and change what does not fit before you send it.")}</p>
      {#if waiting}<p class="mt-2 text-ink/80">{t("The file you dropped on the website is still waiting.")} <a class="underline" href="/create?mode=document&upload=1">{t("Open it")}</a></p>{/if}
    </div><button type="button" class="shrink-0 text-xs underline text-mute" onclick={dismiss}>{t("Hide")}</button></div>
  </div>
{/if}

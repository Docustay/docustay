<script>
  // DETAILS for a TEMPLATE: the same boxes as a document's Details, saved as the template's DEFAULTS (a document made from it starts with them and may change them).
  import ProLock from "$lib/pro/ProLock.svelte";
  import { t } from "$lib/i18n/index.svelte.js";
  import { tl } from "./flowLabels.js";
  import { EXPIRY_CHOICES, REMINDER_CHOICES, LANGUAGE_CHOICES } from "./flowDefinition.js";
  import { languageLabel } from "$lib/i18n.js";
  import Pick from "$lib/ui/Pick.svelte";
  let { tpl = $bindable() } = $props();
  const CHIPS = ["{{signer.name}}", "{{sender.name}}", "{{org.name}}", "{{document.title}}"];
  let focusKey = $state("message"), subjEl, msgEl;
  function chip(c) { const el = focusKey === "subject" ? subjEl : msgEl; if (!el) return; const a = el.selectionStart ?? el.value.length, b = el.selectionEnd ?? a; tpl[focusKey] = el.value.slice(0, a) + c + el.value.slice(b); queueMicrotask(() => { el.focus(); el.setSelectionRange(a + c.length, a + c.length); }); }
  const expiryOpts = EXPIRY_CHOICES.map((c) => ({ value: String(c.days), label: tl(c.label) }));
  const remOpts = REMINDER_CHOICES.map((c) => ({ value: c.id, label: tl(c.label) }));
  const langOpts = [{ value: "auto", label: t("Match each signer’s own language") }, ...LANGUAGE_CHOICES.map((l) => ({ value: l, label: languageLabel(l) }))];
</script>
<div class="max-w-[860px] space-y-4" data-testid="template-details">
  <div class="grid gap-4 rounded-xl border border-line p-5">
    <label class="grid gap-1"><span class="text-sm font-medium">{t("Internal note")}</span><span class="text-xs text-mute">{t("Only you and your team see this. It is never shown to signers.")}</span><textarea class="field" rows="2" bind:value={tpl.internal} data-testid="details-internal"></textarea></label>
    <label class="grid gap-1"><span class="text-sm font-medium">{t("About this document")}</span><span class="text-xs text-mute">{t("The signer reads this on the signing page, above the document.")}</span><textarea class="field" rows="2" bind:value={tpl.about} data-testid="details-description"></textarea></label>
    <label class="grid gap-1"><span class="text-sm font-medium">{t("Rules for the assistant")}</span><span class="text-xs text-mute">{t("Plain sentences the assistant follows when it works on this template or a document made from it. It can never be made to send, charge or sign by these.")}</span><textarea class="field" rows="3" maxlength="1500" bind:value={tpl.aiRules} data-testid="details-ai-rules"></textarea></label>
    <label class="grid gap-1"><span class="text-sm font-medium">{t("Email subject")}</span><input class="field !py-1.5" bind:this={subjEl} bind:value={tpl.subject} onfocus={() => (focusKey = "subject")} data-testid="send-subject" /></label>
    <label class="grid gap-1"><span class="text-sm font-medium">{t("Email message")}</span><textarea class="field" rows="4" bind:this={msgEl} bind:value={tpl.message} onfocus={() => (focusKey = "message")} data-testid="send-message"></textarea></label>
    <div class="flex flex-wrap items-center gap-1.5"><span class="text-xs text-mute">{t("Click to add:")}</span>{#each CHIPS as c}<button type="button" class="chip !min-h-9" onmousedown={(e) => e.preventDefault()} onclick={() => chip(c)}>{c}</button>{/each}</div>
  </div>
  <div class="grid gap-3 rounded-xl border border-line p-5 md:grid-cols-3">
    <ProLock item="auto_reminders" tip={t("Docustay reminds the people who have not signed, on the days you choose.")}>{#snippet children(locked)}<Pick options={remOpts} value={tpl.reminders} disabled={locked} onchange={(v) => (tpl.reminders = v)} label={t("Reminders")} testid="send-reminder-schedule" />{/snippet}</ProLock>
    <Pick options={expiryOpts} value={String(tpl.expiry)} onchange={(v) => (tpl.expiry = Number(v))} label={t("Expires")} testid="send-expiry" />
    <Pick options={langOpts} value={tpl.language} onchange={(v) => (tpl.language = v)} label={t("Language")} testid="send-language" />
  </div>
</div>

<script>
  // DETAILS (step 4): four boxes and nothing else to type. Internal note (only you see it), About this document (the signer sees it on the signing page), Email subject and Email message (the words around
  // the button, with merge fields as chips to click). Reminders, expiry, language and files follow below as pickers. An AI draft's suggestions arrive already filled in.
  import { t } from "$lib/i18n/index.svelte.js";
  import SendStep from "./SendStep.svelte";
  import NewTemplateLock from "$lib/pro/NewTemplateLock.svelte";
  let { doc, onChange, onRefresh } = $props();
  const o = $derived(doc.sendOptions ?? {});
  const set = (p) => onChange({ sendOptions: { ...o, ...p } });
  // D-095: the tick keeps its own state (written through on change), so a refresh of the document in between can not flip it back to the saved default
  let keep = $state(o.save_as_template ?? doc.defaults?.saveAsTemplate ?? false);
  const CHIPS = ["{{signer.name}}", "{{sender.name}}", "{{org.name}}", "{{document.title}}"];
  let focusKey = $state("message"), subjEl, msgEl;
  function chip(c) {   // put the merge field where the cursor is in whichever of the two boxes was last used
    const el = focusKey === "subject" ? subjEl : msgEl; if (!el) return;
    const a = el.selectionStart ?? el.value.length, b = el.selectionEnd ?? a; const v = el.value.slice(0, a) + c + el.value.slice(b);
    set({ [focusKey]: v || undefined }); queueMicrotask(() => { el.focus(); el.setSelectionRange(a + c.length, a + c.length); });
  }
</script>
<div class="min-w-0 space-y-4" data-testid="details-step">
  <div class="grid gap-4 border-y border-line py-5">
    <label class="grid gap-1"><span class="text-sm font-medium">{t("Title")}</span><input class="field !py-1.5" value={doc.title} oninput={(e) => onChange({ title: e.currentTarget.value })} data-testid="pdf-title" /></label>
    <label class="grid gap-1"><span class="text-sm font-medium">{t("Internal note")}</span><span class="text-xs text-mute">{t("Only you see this. It is never shown to signers or put in the signed copy.")}</span>
      <textarea class="field" rows="2" value={o.internal_note ?? ""} oninput={(e) => set({ internal_note: e.currentTarget.value || undefined })} data-testid="details-internal"></textarea></label>
    <label class="grid gap-1"><span class="text-sm font-medium">{t("About this document")}</span><span class="text-xs text-mute">{t("The signer reads this on the signing page, above the document.")}</span>
      <textarea class="field" rows="2" value={doc.description ?? ""} oninput={(e) => onChange({ description: e.currentTarget.value })} data-testid="details-description"></textarea></label>
    <label class="grid gap-1"><span class="text-sm font-medium">{t("Email subject")}</span>
      <input class="field !py-1.5" bind:this={subjEl} value={o.subject ?? ""} placeholder={t("{title} — please sign", { title: doc.title })} onfocus={() => (focusKey = "subject")} oninput={(e) => set({ subject: e.currentTarget.value || undefined })} data-testid="send-subject" /></label>
    <label class="grid gap-1"><span class="text-sm font-medium">{t("Email message")}</span><span class="text-xs text-mute">{t("The words in the email, above the button.")}</span>
      <textarea class="field" bind:this={msgEl} rows="4" value={o.message ?? ""} onfocus={() => (focusKey = "message")} oninput={(e) => set({ message: e.currentTarget.value || undefined })} data-testid="send-message"></textarea></label>
    <div class="flex flex-wrap items-center gap-1.5" data-testid="merge-chips"><span class="text-xs text-mute">{t("Click to add:")}</span>{#each CHIPS as c}<button type="button" class="chip !min-h-9" onmousedown={(e) => e.preventDefault()} onclick={() => chip(c)} data-testid="chip-{c.replace(/[{}.]/g, '')}">{c}</button>{/each}</div>
    <NewTemplateLock testid="prolock-keep-template">{#snippet children(locked)}<label class="flex items-center gap-2 text-sm"><input type="checkbox" checked={keep && !locked} disabled={locked} onchange={(e) => { keep = e.currentTarget.checked; set({ save_as_template: keep }); }} data-testid="de-keep" /> {t("Also keep this as a template")}</label>{/snippet}</NewTemplateLock>
  </div>
  <SendStep {doc} {onChange} {onRefresh} />
</div>

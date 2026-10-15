<script>
  import { ask } from "$lib/ui/confirm.svelte.js";
  import EmailPreview from "$lib/ui/EmailPreview.svelte";
  import { live } from "$lib/live.js";
  // Settings → Email templates: the eight emails Docustay sends about a document, in the workspace's own words. Pick a message and a language, change the subject, preview line, body, button and footer,
  // see exactly how it will look, send yourself a test, or go back to the standard wording. {{variables}} are filled in when it is sent; the sign button and its link are always in the email.
  import { onMount } from "svelte";
  import { api } from "$lib/api.js";
  import { t, td } from "$lib/i18n/index.svelte.js";
  import { toast } from "$lib/ui/toast.js";
  import { languageLabel } from "$lib/i18n.js";
  import Pick from "$lib/ui/Pick.svelte";
  const un = (r) => r.json?.data ?? r.json;
  const LANGS = ["en", "es", "fr", "de", "pt", "it", "nl", "pl", "tr", "ru", "ar", "ja", "zh", "ko"];
  let messages = $state(null), problem = $state(null), kind = $state("invitation"), locale = $state("en"), busy = $state(false), prev = $state(null), previewing = $state(false);
  let f = $state({ subject: "", preview: "", body: "", buttonLabel: "", footer: "" }), focus = $state("body");
  const cur = $derived(messages?.find((m) => m.kind === kind) ?? null);
  async function load(keep = true) {
    const r = await api(`/api/documents/email/messages?locale=${locale}`); if (!r.ok) { problem = r.error ?? t("The emails could not be loaded."); return; }
    messages = un(r).messages; problem = null; fill(); if (keep) await preview();
  }
  // the form starts from what the workspace saved, or empty (the standard wording shows as a grey hint)
  function fill() { const s = cur?.saved; f = { subject: s?.subject ?? "", preview: s?.preview ?? "", body: s?.body ?? "", buttonLabel: s?.buttonLabel ?? "", footer: s?.footer ?? "" }; }
  onMount(() => { load(); return live(["email", "settings"], () => load()); });
  function pickKind(k) { kind = k; fill(); preview(); }
  async function pickLocale(l) { locale = l; await load(); }
  let timer;
  function changed() { clearTimeout(timer); timer = setTimeout(preview, 450); }
  async function preview() { previewing = true; const r = await api("/api/documents/email/messages/preview", { method: "POST", body: { kind, locale, draft: { ...f } } }); previewing = false; prev = r.ok ? un(r) : { error: r.error }; }
  async function save() { busy = true; const r = await api("/api/documents/email/messages/save", { method: "POST", body: { kind, locale, ...f } }); busy = false; if (r.ok) { toast(t("Saved."), "ok"); await load(false); } else toast(r.error ?? t("That could not be saved."), "bad"); }
  async function reset() { if (!await ask(t("Go back to the standard wording for this email in this language?"))) return; busy = true; const r = await api("/api/documents/email/messages/reset", { method: "POST", body: { kind, locale } }); busy = false; if (r.ok) { toast(t("Back to the standard wording."), "ok"); await load(); } else toast(r.error ?? t("That could not be reset."), "bad"); }
  async function test() { busy = true; const r = await api("/api/documents/email/messages/test", { method: "POST", body: { kind, locale, draft: { ...f } } }); busy = false; const o = r.ok ? un(r) : null; if (o?.sent) toast(t("Sent to {to}.", { to: o.to }), "ok"); else toast(o?.error ?? r.error ?? t("The test could not be sent."), "bad"); }
  function insert(v) { const el = document.getElementById(`em-${focus}`); const tag = `{{${v}}}`; if (!el || !(focus in f)) { f.body += tag; changed(); return; } const a = el.selectionStart ?? f[focus].length, b = el.selectionEnd ?? a; f[focus] = f[focus].slice(0, a) + tag + f[focus].slice(b); changed(); queueMicrotask(() => { el.focus(); el.setSelectionRange(a + tag.length, a + tag.length); }); }
  const dirty = $derived(cur ? JSON.stringify(f) !== JSON.stringify({ subject: cur.saved?.subject ?? "", preview: cur.saved?.preview ?? "", body: cur.saved?.body ?? "", buttonLabel: cur.saved?.buttonLabel ?? "", footer: cur.saved?.footer ?? "" }) : false);
</script>
{#if problem}<p class="notice bad" role="alert">{problem}</p>{:else if !messages}<p class="text-mute">{t("Loading…")}</p>{:else}
<div class="grid max-w-6xl gap-6 lg:grid-cols-[14rem_minmax(0,1fr)_minmax(0,24rem)]" data-testid="email-templates">
  <nav aria-label={t("Emails")} class="flex flex-row gap-1 overflow-x-auto lg:flex-col">
    {#each messages as m (m.kind)}
      <button class="rounded-lg px-3 py-2 text-left text-sm {kind === m.kind ? 'bg-tint font-medium' : 'text-mute hover:bg-tint'}" onclick={() => pickKind(m.kind)} data-testid="em-kind-{m.kind}" aria-current={kind === m.kind}>
        {td(m.label)}{#if m.saved}<span class="ml-1 text-xs text-brand" title={t("You changed this email")}>●</span>{/if}
      </button>
    {/each}
  </nav>
  <section class="min-w-0 space-y-4">
    <div><h2 class="text-lg font-semibold">{td(cur.label)}</h2><p class="text-sm text-mute">{t("Goes to: {who}", { who: td(cur.to) })}</p></div>
    <div class="flex items-center gap-2"><span class="label !mb-0">{t("Language")}</span><Pick options={LANGS.map((l) => ({ value: l, label: languageLabel(l) + ((cur.languages ?? []).includes(l) ? " ●" : "") }))} value={locale} onchange={pickLocale} label={t("Language")} testid="em-locale" /></div>
    {#if locale !== "en" && !cur.saved}<p class="text-xs text-mute">{t("Left empty, people reading this language get Docustay's own translated email.")}</p>{/if}
    <label class="label" for="em-subject">{t("Subject")}</label><input id="em-subject" class="field" bind:value={f.subject} oninput={changed} onfocus={() => (focus = "subject")} placeholder={cur.standard.subject} data-testid="em-subject" />
    <label class="label" for="em-preview">{t("Preview line")} <span class="text-mute">({t("the grey line beside the subject")})</span></label><input id="em-preview" class="field" bind:value={f.preview} oninput={changed} onfocus={() => (focus = "preview")} placeholder={cur.standard.preview} data-testid="em-preview" />
    <label class="label" for="em-body">{t("Message")}</label><textarea id="em-body" class="field" rows="7" bind:value={f.body} oninput={changed} onfocus={() => (focus = "body")} placeholder={cur.standard.body} data-testid="em-body"></textarea>
    {#if cur.button}<label class="label" for="em-buttonLabel">{t("Button")}</label><input id="em-buttonLabel" class="field" bind:value={f.buttonLabel} oninput={changed} onfocus={() => (focus = "buttonLabel")} placeholder={cur.standard.buttonLabel} data-testid="em-button" /><p class="text-xs text-mute">{t("The button and its link are always in the email. You choose what it says.")}</p>{/if}
    <label class="label" for="em-footer">{t("Footer")} <span class="text-mute">({t("optional")})</span></label><textarea id="em-footer" class="field" rows="2" bind:value={f.footer} oninput={changed} onfocus={() => (focus = "footer")} placeholder={t("For example: Questions? Reply to this email or call us on 555 0100.")} data-testid="em-footer"></textarea>
    <div class="flex flex-wrap items-center gap-2" aria-label={t("Insert a detail")}><span class="text-xs text-mute">{t("Insert")}</span>{#each cur.vars as v (v)}<button type="button" class="chip mute font-mono !text-[.7rem]" onclick={() => insert(v)} data-testid="em-var-{v}">{`{{${v}}}`}</button>{/each}</div>
    <div class="flex flex-wrap gap-2 pt-1">
      <button class="btn primary" onclick={save} disabled={busy || !dirty} data-testid="em-save">{t("Save")}</button>
      <button class="btn" onclick={test} disabled={busy} data-testid="em-test">{t("Send me a test")}</button>
      {#if cur.saved}<button class="btn" onclick={reset} disabled={busy} data-testid="em-reset">{t("Use the standard wording")}</button>{/if}
    </div>
  </section>
  <aside class="min-w-0" aria-label={t("Preview")}>
    <p class="label">{t("Preview")} <span class="text-mute">({t("made-up names")})</span></p>
    {#if prev?.error}<p class="text-sm text-bad" role="alert">{prev.error}</p>
    {:else if prev}
      <EmailPreview subject={prev.subject} line={prev.preview} html={prev.html} height={544} title={t("How the email will look")} subjectId="em-prev-subject" frameId="em-frame" />
    {:else}<p class="text-sm text-mute">{previewing ? t("Loading…") : ""}</p>{/if}
  </aside>
</div>{/if}

<script>
  import { checkText } from "$lib/editor/checkStrings.js";
  import PageSkel from "$lib/ui/PageSkel.svelte";
  import { ask } from "$lib/ui/confirm.svelte.js";
  import { onMount, onDestroy } from "svelte";
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import { api } from "$lib/api.js";
  import { t } from "$lib/i18n/index.svelte.js";
  import FlowSteps from "$lib/flow/FlowSteps.svelte";
  import PeopleStep from "$lib/editor/PeopleStep.svelte";
  import FieldsStep from "$lib/editor/FieldsStep.svelte";
  import DetailsStep from "$lib/editor/DetailsStep.svelte";
  import CheckStep from "$lib/editor/CheckStep.svelte";
  import SendSummary from "$lib/editor/SendSummary.svelte";
  import PrepareWritten from "$lib/flow/PrepareWritten.svelte";
  import { personFacts, rewriteRoles } from "$lib/flow/roles.js";
  import { uploadFile } from "$lib/docs.js";
  import GuideStrip from "$lib/starters/GuideStrip.svelte";
  import { toast } from "$lib/ui/toast.js";
  import { chatBridge } from "$lib/chat/bridge.js";
  import { DOC_CHANGED } from "$lib/chat/chat.svelte.js";
  import autoAnimate from "@formkit/auto-animate";
  import { sendPlan, sentLine } from "$lib/flow/sendPlan.js";
  import { edition } from "$lib/edition.svelte.js";
  const id = page.params.id;
  let focusField = $state(null);   // Run 9: the box the Check step's "Fix" points at
  const STEPS = $derived([["people", t("Who signs")], ["prepare", t("Prepare")], ["details", t("Details")], ["check", t("Check it")], ["send", t("Send")]]);
  let doc = $state(null), step = $state(page.url.searchParams.get("step") ?? "people"), saving = $state("saved"), problem = $state(null), problemUpgrade = $state(false), sending = $state(false), pending = {}, timer, attempted = $state(false), peopleTried = $state(false), prep = $state({}), wordsDirty = $state(false), revising = $state(false), phase = $state("loading");
  // D-094: a file that already carries a digital signature takes no new fields; say so up front instead of failing on the first placed field
  const signedFile = $derived(Boolean(doc?.files?.find((f) => f.id === doc?.body?.file?.file_id)?.meta?.already_signed));
  const fileUrl = $derived(doc ? `/api/documents/pdf/${encodeURIComponent(id)}/file/${encodeURIComponent(doc.body.file.file_id)}` : "");
  async function load() {
    const r = await api(`/api/documents/pdf/${id}`);
    if (!r.ok) { phase = r.status === 404 ? "missing" : "error"; problem = r.error; return; }
    if (r.json.state !== "draft") { await goto(`/documents/${id}`); return; }
    doc = r.json; phase = "ready";
    // USE A TEMPLATE: "Who plays each part" — one row per role of the template, labelled with the role; a role marked "a fixed person" arrives filled in
    if (page.url.searchParams.get("from") === "template" && !(doc.parties ?? []).length && (doc.body?.roles ?? []).length) {
      const plays = doc.sendOptions?.plays ?? {};
      const parties = doc.body.roles.map((ro, i) => { const pl = plays[ro.label]; return { role: ro.key, name: pl?.plays === "fixed" ? pl.name ?? ro.label : "", email: pl?.plays === "fixed" ? pl.email ?? null : null, phone: null, action_role: "signer", external_ref: null, expires_at: null, reminder_days: null, assists_role: null, step: i + 1 }; });
      change({ parties });
    }
  }
  onMount(load);
  // the assistant changed or sent this draft (people, details, a copy of the words, a send): show what is true now
  onMount(() => { const h = (e) => { const d = e.detail ?? {}; if (d.documentId !== id && d.previousId !== id) return; if (d.sent) { goto(`/documents/${id}`); return; } if (d.previousId === id && d.documentId && d.documentId !== id) { location.assign(`/documents/${d.documentId}/edit?step=${step}`); return; } if (!d.created) load(); }; window.addEventListener(DOC_CHANGED, h); return () => window.removeEventListener(DOC_CHANGED, h); });
  $effect(() => { if (!doc) return; return chatBridge.setPage({ documentId: id, title: doc.title ?? doc.body?.title ?? null }); });   // the assistant knows which draft is open on every step
  async function flush() {
    const patch = pending; pending = {}; if (!Object.keys(patch).length) return;
    saving = "saving";
    const r = await api("/api/documents/pdf/save", { method: "POST", body: { instanceId: id, ...patch } });
    if (!r.ok) { saving = "error"; problem = r.error ?? t("That could not be saved."); toast(problem, "bad"); return; }
    // keep what the person is editing: the server's answer refreshes people, checklist and status, not the field boxes in their hands
    problem = null; doc = { ...r.json, body: patch.body ?? (patch.parties && doc.body && r.json.body?.roles ? { ...doc.body, roles: r.json.body.roles } : doc.body), ...(patch.parties ? { parties: doc.parties } : {}) }; saving = Object.keys(pending).length ? "saving" : "saved";
  }
  function change(p) {
    pending = { ...pending, ...p };
    doc = { ...doc, ...(p.body ? { body: p.body } : {}), ...(p.parties ? { parties: p.parties.map((x, i) => ({ ...x, seat_label: x.name, id: doc.parties[i]?.id ?? x.role })) } : {}), ...(p.sendOptions ? { sendOptions: p.sendOptions } : {}), ...(p.title !== undefined ? { title: p.title } : {}), ...(p.description !== undefined ? { description: p.description } : {}) };
    saving = "saving"; clearTimeout(timer); timer = setTimeout(flush, 800);
  }
  onDestroy(() => { clearTimeout(timer); if (Object.keys(pending).length) flush(); });
  const EMAIL_OK = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
  // EDIT THE WORDS UNTIL SEND: a document made from words keeps them; leaving Prepare with changes prints the new words into a fresh draft that keeps the people and the choices (a new id).
  const editable = $derived(Boolean(doc?.source));
  const wordPeople = $derived((doc?.parties ?? []).map((p) => ({ ...p, roleWord: doc.body.roles.find((r) => r.key === p.role)?.label ?? p.name })));
  const sourceCustom = $derived(Object.fromEntries(Object.entries(doc?.sourceFacts ?? {}).filter(([k]) => k.startsWith("custom.") && !k.startsWith("custom.p_"))));
  async function revise(target) {
    revising = true; problem = null; clearTimeout(timer); await flush();
    // the words keep the role names they have (Client, Provider); a person's own name sits beside the role
    const vv = doc.variableValues ?? {};   // answers to a template's questions stay with the document
    const src = prep.getSource(), facts = { ...(doc.sourceFacts ?? {}), ...Object.fromEntries(Object.entries(vv).map(([k, v]) => [`custom.${k}`, String(v)])), ...prep.getCustom(), ...personFacts(wordPeople) };
    const r = await api("/api/documents/engine/documents/revise", { method: "POST", body: { instanceId: id, source: src, facts, ...(Object.keys(vv).length ? { variableValues: vv } : {}) } });
    revising = false;
    if (!r.ok) { problem = r.error ?? t("That could not be saved."); toast(problem, "bad"); return; }
    wordsDirty = false; location.assign(`/documents/${(r.json?.data ?? r.json).instanceId}/edit?step=${target}`);
  }
  async function go(k) { if (Object.keys(pending).length) { clearTimeout(timer); await flush(); }   /* Round 3 R3-4: what was just typed is saved before the next step is shown, so the checklist is never one edit behind */
    if (step === "prepare" && editable && wordsDirty && k !== "prepare") { await revise(k); return; } step = k; toTop(); }
  // Run 10 (R10-50): a step opened wherever the last one was scrolled to (Next from the bottom of Prepare landed in the middle of Details, step bar and first fields out of sight); each step now opens at its top
  const toTop = () => { if (typeof window !== "undefined") requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: "instant" })); };
  // REPLACE THE FILE: an uploaded file is not word-editable, but a new version of it can take over the fields that still fit, the people and the settings
  let replacing = $state(false), replaceInput = $state(null);
  async function replaceFile(file) {
    if (!file) return; replacing = true; problem = null;
    try {
      clearTimeout(timer); await flush();
      const up = await uploadFile(file);
      const r = await api("/api/documents/pdf/replace-file", { method: "POST", body: { instanceId: id, withInstanceId: up.instanceId } });
      if (!r.ok) throw new Error(r.error ?? t("That file could not be used."));
      const out = r.json?.data ?? r.json; toast(out.fieldsDropped ? t("The file was replaced. {n} fields did not fit on its pages and were removed.", { n: out.fieldsDropped }) : t("The file was replaced. Your fields, people and settings were kept."), "ok");
      location.assign(`/documents/${out.instanceId}/edit?step=prepare`);
    } catch (e) { problem = e.message || t("That did not upload. Try again."); toast(problem, "bad"); replacing = false; }
  }
  const onUnload = (e) => { if (wordsDirty) { e.preventDefault(); e.returnValue = ""; } };
  function next() { if (step === "people" && (doc.parties ?? []).some((p) => p.email && !EMAIL_OK.test(p.email))) { peopleTried = true; return; } if (step === "people") { const keep = (doc.parties ?? []).filter((p) => (p.name ?? "").trim() || (p.email ?? "").trim()); if (keep.length !== (doc.parties ?? []).length) { change({ parties: keep.map((p) => ({ role: p.role, name: p.name ?? "", email: p.email ?? null, phone: p.phone ?? null, action_role: p.action_role ?? "signer", external_ref: p.external_ref ?? null, expires_at: p.expires_at ?? null, reminder_days: p.reminder_days ?? null, assists_role: (p.action_role ?? "signer") === "assistant" ? p.assists_role ?? null : null, step: p.step ?? null, ...((p.action_role ?? "signer") === "signer" && p.group_label ? { group_label: p.group_label } : {}), ...((p.action_role ?? "signer") === "signer" && p.witness_required ? { witness_required: true } : {}) })) }); } }   /* P10-A-14: an empty added row is not a person */
    if (step === "check") attempted = true; go(STEPS[idx + 1][0]); }
  async function send() {
    if (!ok) { attempted = true; return; }
    sending = true; problem = null; clearTimeout(timer); await flush();
    const r = await api("/api/documents/pdf/send", { method: "POST", body: { instanceId: id } });
    sending = false;
    if (!r.ok) { problemUpgrade = r.json?.error?.detail?.code === "plan_document_limit" && /Upgrade to Pro/.test(r.json?.error?.message ?? ""); const all = r.json?.error?.detail?.problems; problem = Array.isArray(all) && all.length > 1 ? all.join("\n") : (r.error ?? t("It could not be sent.")); toast(all?.length > 1 ? t("{n} things stop this from being sent.", { n: all.length }) : problem, "bad"); return; }
    const out = r.json?.data ?? r.json ?? {};
    if (out.scheduled && out.sendAt) toast(t("Scheduled. Nothing is emailed until {when}.", { when: new Date(out.sendAt).toLocaleString() }), "ok");   // a scheduled send has not gone to anybody yet: it must not say "Sent"
    else if (out.notEmailed?.length) toast(t("Sent, but not everyone was emailed."), "info", 8000);   // R8-62: the document page says who and why; never "has been emailed" when nobody was
    else toast(sentLine(sendPlan(doc.parties, doc.sendOptions?.in_person ?? [], edition.testMode, doc.sendOptions?.order), t), "ok");
    // Run 8 verify: "also keep this as a template" at the Free cap — the document went out, the template was not kept; say so instead of leaving it silent
    if (out.templateNotKept) toast(t("It was not kept as a template: this month's {limit} new templates on Free are used.", { limit: out.templateNotKept.limit }), "info", 8000);
    await goto(`/documents/${id}${out.scheduled ? "" : "?sent=1"}`);   // Run 7: the document page shows the sent moment once
  }
  const idx = $derived(STEPS.findIndex(([k]) => k === step)), ok = $derived(doc?.checklist?.ok), first = $derived((() => { const i = doc?.checklist?.items?.find((x) => !x.ok && x.severity !== "warning"); return i ? checkText(i, t) : ""; })());

  // ★ Run 7: an uploaded PDF started from Form templates (?as=form) ends in Publish, not Send: it is saved as a FORM template and opens the Forms page's Publish panel for that form
  const asForm = page.url.searchParams.get("as") === "form";
  const asTemplate = page.url.searchParams.get("as") === "template";   // P10-A-1: Templates → New document template → Upload ends in Save template, not Send
  async function makeTemplate() {
    sending = true; problem = null; clearTimeout(timer); await flush();
    const r = await api("/api/documents/pdf/save-template", { method: "POST", body: { instanceId: id, kind: "document", name: doc.title } });
    if (!r.ok) { sending = false; problem = r.error ?? t("That could not be saved as a template."); return; }
    await api("/api/documents/pdf/discard", { method: "POST", body: { instanceId: id } });   // the working draft is not a document: nothing is left behind in Documents
    sending = false;
    await goto("/templates");
  }
  async function makeForm() {
    sending = true; problem = null;
    const r = await api("/api/documents/pdf/save-template", { method: "POST", body: { instanceId: id, kind: "form", name: doc.title } });
    sending = false;
    if (!r.ok) { problem = r.error ?? t("That could not be saved as a form."); return; }
    await goto(`/forms?new=${encodeURIComponent(r.json?.data?.templateId ?? r.json?.templateId)}`);
  }
</script>
<svelte:window onbeforeunload={onUnload} />
<svelte:head><title>{t("Set up")} · {doc?.title ?? t("Document")} · Docustay</title></svelte:head>
{#if phase === "loading"}<PageSkel kind="flow" testid="edit-loading" />
{:else if phase !== "ready"}<p class="text-bad" role="alert">{phase === "missing" ? t("That document does not exist.") : (problem ?? t("It could not be loaded."))}</p>
{:else}
  <div class="mb-4 flex flex-wrap items-center gap-3">
    <h1 class="max-w-full truncate text-lg font-medium" data-testid="pdf-heading">{doc.title}</h1>
    <span class="text-sm text-mute" role="status" data-testid="pdf-saving">{saving === "saving" ? t("Saving…") : saving === "error" ? t("Not saved") : t("Saved")}</span>
    {#if !editable}<button class="btn ml-auto !py-1.5" disabled={replacing} onclick={() => replaceInput?.click()} data-testid="pdf-replace">{replacing ? t("Replacing…") : t("Replace file")}</button><input bind:this={replaceInput} type="file" class="sr-only" accept=".pdf,.docx,.xlsx,.pptx,.jpg,.jpeg,.png,application/pdf,image/png,image/jpeg" onchange={(e) => { replaceFile(e.currentTarget.files?.[0]); e.currentTarget.value = ""; }} data-testid="pdf-replace-input" />{/if}
    <a class="btn {editable ? 'ml-auto' : ''} !py-1.5" href="/documents">{t("Back to documents")}</a>
  </div>
  {#if (doc.package?.members?.length ?? 0) > 1}
    <nav class="mb-3 flex flex-wrap items-center gap-2 text-sm" aria-label={t("Documents in this send")} data-testid="pdf-package">
      <span class="text-mute">{t("Documents in this send")}:</span>
      {#each doc.package.members as m (m.id)}<a class="btn !py-1 {m.id === doc.id ? 'primary' : ''}" aria-current={m.id === doc.id ? "page" : undefined} href={`/documents/${m.id}/edit?step=${step}`} data-sveltekit-reload>{m.title}</a>{/each}
      {#if !doc.package.isLead}<a class="text-brand underline" href={`/documents/${doc.package.leadId}/edit?step=send`} data-sveltekit-reload>{t("Send them all from the first document")}</a>{/if}
    </nav>
  {/if}
  <GuideStrip {step} onstep={(k) => go(k)} />
  <div data-testid="pdf-steps"><FlowSteps current={asForm && step === "send" ? "publish" : step} mode={asForm ? "form" : "document"} onpick={(k) => { if (k === "start") goto(asForm ? "/create?mode=form" : "/create"); else if (k === "publish") go("send"); else if (k !== "write") go(k); }} /></div>
  {#if page.url.searchParams.get("again") === "1" && step === "people"}<p class="notice mb-4" role="status" data-testid="sent-again-note">{t("This is a new copy with the same file, fields and people. Check them and send it. Any access code or extra file needs adding again.")}</p>{/if}
  {#if step === "people"}<PeopleStep {doc} attempted={peopleTried} onChange={change} mode={page.url.searchParams.get("from") === "template" ? "use" : "document"} />{:else if step === "prepare" && editable}{#key doc.id}<PrepareWritten initial={doc.source} initialCustom={sourceCustom} people={wordPeople} mode="document" onchange={() => (wordsDirty = true)} bind:api={prep} />{/key}{:else if step === "prepare" && signedFile}<p class="notice warn" role="status" data-testid="prepare-sealed">{t("This file already carries a digital signature, so fields cannot be added to it without breaking that signature. It will be sent exactly as it is.")}</p>{:else if step === "prepare"}{#key doc.id}<FieldsStep {doc} {fileUrl} {focusField} onChange={(body) => change({ body })} />{/key}{:else if step === "details"}<DetailsStep {doc} onChange={change} onRefresh={load} />{:else if step === "check"}<CheckStep {doc} {fileUrl} {attempted} onRefresh={load} onfix={(f) => { focusField = f.field ?? null; go(f.step); }} />{:else}<SendSummary {doc} />{/if}
  <div class="mt-6 flex flex-wrap items-center gap-3 border-t border-line pt-4" data-testid="pdf-footer">
    {#if idx > 0}<button class="btn" onclick={() => go(STEPS[idx - 1][0])} data-testid="pdf-back">{t("Back")}</button>{/if}
    {#if step !== "send"}<button class="btn primary" onclick={next} data-testid="pdf-next">{t("Next")}</button>
    {:else if asTemplate}<button class="btn primary" disabled={sending} onclick={makeTemplate} data-testid="pdf-make-template">{t("Save template")}</button>
    {:else if asForm}<button class="btn primary" disabled={sending} onclick={makeForm} data-testid="pdf-make-form">{t("Save as a form")}</button>
    {:else}<button class="btn primary" disabled={sending} onclick={send} data-testid="pdf-send">{doc.sendOptions?.send_at ? t("Schedule it") : t("Send")}</button>
      {#if !ok}{#if saving === "saving"}<span class="text-sm text-mute" data-testid="pdf-not-ready">{t("Saving…")}</span>{:else}<span class="text-sm {attempted ? 'text-bad' : 'text-warn'}" data-testid="pdf-not-ready">{attempted ? t("Not ready: {reason}", { reason: first }) : t("Still to do: {reason}", { reason: first })}</span>{/if}{/if}{/if}
    <button class="btn ml-auto" onclick={async () => { if (await ask(t("Discard this draft? The uploaded file is removed."))) { await api("/api/documents/pdf/discard", { method: "POST", body: { instanceId: id } }); await goto("/documents"); } }} data-testid="pdf-discard">{t("Discard draft")}</button>
  </div>
  {#if revising}<p class="mt-3 text-sm" role="status" data-testid="pdf-revising">{t("Updating the document…")}</p>{/if}
  {#if problem}<p class="mt-3 text-sm text-bad" role="alert" data-testid="pdf-error" style="white-space:pre-line">{problem}{#if problemUpgrade}{" "}<a class="font-medium underline" href="/billing" data-testid="pdf-error-upgrade">{t("Upgrade in Billing")}</a>{/if}</p>{/if}
{/if}

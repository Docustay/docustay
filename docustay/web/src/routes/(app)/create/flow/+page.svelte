<script>
  import { handleRefusal } from "$lib/pro/planPrompt.svelte.js";
  import { scrollMainTo } from "$lib/ui/scroll.js";
  import { stepIn } from "$lib/ui/transitions.js";
  // Run 7 part 8: each step slides in from the side it came from (the container is animated, nothing remounts)
  const STEP_ORDER = ["people", "fill", "prepare", "details", "check", "save", "publish"];
  let lastStep = null;
  const stepMotion = (el) => { const now = step; if (lastStep && lastStep !== now && typeof window !== "undefined") requestAnimationFrame(() => scrollMainTo(0));   /* Run 10 (R10-50): each step opens at its top */
    if (lastStep && lastStep !== now) stepIn(el, STEP_ORDER.indexOf(now) >= STEP_ORDER.indexOf(lastStep) ? 1 : -1); lastStep = now; };
  import PageSkel from "$lib/ui/PageSkel.svelte";
  // THE WRITTEN-DOCUMENT FLOW (Start → Who signs → Prepare, then the document exists and Details, Check and Send follow on its own page). The same screens serve a ready-made, a blank page and an AI draft;
  // the people are named BEFORE anything is written or placed, and the text then follows them. Nothing is created until Next on Prepare.
  import { onMount } from "svelte";
  import { page } from "$app/state";
  import { goto, beforeNavigate } from "$app/navigation";
  import { api } from "$lib/api.js";
  import { t } from "$lib/i18n/index.svelte.js";
  import { toast } from "$lib/ui/toast.js";
  import FlowSteps from "$lib/flow/FlowSteps.svelte";
  import PageHeader from "$lib/ui/PageHeader.svelte";
  import PeopleStep from "$lib/editor/PeopleStep.svelte";
  import Pick from "$lib/ui/Pick.svelte";
  import { previewHtml } from "$lib/flow/flowPreview.js";
  import { SEAT_COLOURS } from "$lib/editor/fields.js";
  import { REMINDER_CHOICES } from "$lib/flow/flowDefinition.js";
  import { rolesOf, rewriteRoles, uniqueWord, personFacts, variablesOf } from "$lib/flow/roles.js";
  import { chatBridge } from "$lib/chat/bridge.js";
  import { entitled, loadPlan } from "$lib/pro/plan.svelte.js";

  const ENGINE = "/api/documents/engine";
  const q = page.url.searchParams;
  const mode = q.get("mode") === "template" ? "template" : "document";
  const templateParam = q.get("template"), slugParam = q.get("slug"), jobParam = q.get("job");
  const BLANK = { type: "doc", content: [{ type: "paragraph" }] };
  const val = (r) => r.json?.data ?? r.json;
  const msg = (e) => (typeof e === "string" ? e : e?.message ?? e?.text ?? JSON.stringify(e));

  let step = $state("people"), loading = $state(true), busy = $state(false), problem = $state(null), dirty = $state(false);
  let name = $state(""), paper = $state("letter"), source = $state(BLANK), people = $state([]), sendOptions = $state({}), suggest = $state(null), ai = $state(null), ticks = $state({}), attempted = $state(false);
  // USING a template (not editing one): people, then the template's questions, then the document exists
  const useMode = Boolean(templateParam) && mode === "document";
  // Run 8 verify: a NEW template (not a new version of one) at the Free cap — the plain message with Explore Pro up front, before the work, not only at Save (the server refuses at Save)
  const capped = $derived(mode === "template" && !templateParam && entitled("unlimited_templates") === false);
  onMount(() => { if (mode === "template" && !templateParam) loadPlan(); });
  let varValues = $state({}), varsTried = $state(false);
  // on the questions step the floating assistant can read the template and propose answers (it applies them here)
  $effect(() => { if (step !== "fill") return; return chatBridge.register({ getSource: () => prep?.getSource?.(), getValues: () => $state.snapshot(varValues), applyValues: (v) => (varValues = { ...varValues, ...v }), apply: (s) => prep?.setSource?.(s) }); });
  let prep = $state({}), changeNote = $state(""), tplDefaults = $state(null);
  let tpl = $state({ aiRules: "", internal: "", about: "", subject: "", message: "", reminders: "3_7", expiry: 30 });
  let chk = $state(null), chkView = $state("see_it"), chkAs = $state("");
  const docState = $derived({ parties: people.map((p) => ({ ...p })), sendOptions, suggestedSeats: [] });

  // A DRAFT THAT SURVIVES A REFRESH: until Next on Prepare the document exists only in this browser, so what has been typed is kept here (one slot per way of starting) and offered again on return.
  const DRAFT_KEY = `ds-flow-draft:${mode}:${templateParam ?? slugParam ?? jobParam ?? (q.get("guided") ? "guided" : "blank")}`;
  const readDraft = () => { try { return JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "null"); } catch { return null; } };
  const clearDraft = () => { try { localStorage.removeItem(DRAFT_KEY); } catch {} };
  let resumed = $state(null), edits = $state(0), savedCustom = $state({}), saveT;
  function snapshot() { return { v: 1, ts: Date.now(), step, name, paper, people: $state.snapshot(people), sendOptions: $state.snapshot(sendOptions), source: step === "prepare" && prep.getSource ? prep.getSource() : $state.snapshot(source), custom: prep.getCustom ? prep.getCustom() : savedCustom, tpl: $state.snapshot(tpl), varValues: $state.snapshot(varValues) }; }
  $effect(() => { void [name, people, sendOptions, step, tpl, edits, varValues]; if (loading || !dirty) return; clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(snapshot())); } catch {} }, 800); });
  const startAgain = () => { clearDraft(); dirty = false; location.reload(); };
  async function load() {
    const saved = readDraft();
    if (saved?.v === 1 && saved.source) {
      name = saved.name ?? ""; paper = saved.paper ?? "letter"; people = saved.people ?? []; sendOptions = saved.sendOptions ?? {}; source = saved.source; savedCustom = saved.custom ?? {}; tpl = { ...tpl, ...(saved.tpl ?? {}) };
      varValues = { ...varValues, ...(saved.varValues ?? {}) };
      step = ["people", "fill", "prepare", "details", "check", "save"].includes(saved.step) && (saved.step === "people" || people.length) ? (saved.step === "check" || saved.step === "save" ? "prepare" : saved.step) : "people";
      resumed = saved.ts; dirty = true; loading = false; return;
    }
    let doc = BLANK, pp = null;
    if (templateParam) {
      const r = await api(`${ENGINE}/templates/${encodeURIComponent(templateParam)}/source`);
      if (!r.ok) problem = r.error ?? t("That template could not be opened."); else { const d = val(r); doc = d.source; name = d.name ?? ""; tplDefaults = d.defaults ?? null; }
    } else if (slugParam) {
      // Run 9 Part 4R: there is no ready-made start any more — a built-in template is sent from, or customized, on Templates (an old link lands on that row)
      await goto(`/templates?kind=${mode === "form" ? "form" : "document"}&starter=${encodeURIComponent(slugParam)}`, { replaceState: true }); return;
    } else if (jobParam) {
      const r = await api(`${ENGINE}/ai/jobs/${encodeURIComponent(jobParam)}`);
      if (!r.ok) problem = r.error ?? t("That draft could not be opened.");
      else {
        const j = val(r);
        if (j.source) {
          doc = j.source; name = j.patches?.title ?? ""; pp = j.patches ?? {};
          if (pp.agent) {
            const items = [...(pp.assumptions ?? []).map((x) => ({ kind: "assumed", text: x })), ...(pp.open_questions ?? []).map((x) => ({ kind: "question", text: x })), ...(pp.careful ?? []).map((x) => ({ kind: "careful", text: x })), ...(pp.checks ?? []).map((x) => ({ kind: "check", text: x })), ...(pp.review ?? []).map((x) => ({ kind: "reader", text: x }))];
            ai = { agent: pp.agent.name, items };
            suggest = { subject: pp.email?.subject, message: pp.email?.message, reminders: pp.reminders, expiry: pp.expiry_days };
          }
        } else problem = j.message ?? t("That draft is not ready.");
      }
    } else if (q.get("guided")) {
      try { const g = JSON.parse(sessionStorage.getItem("ds-guided") ?? "null"); if (g?.source) { doc = g.source; name = g.title ?? ""; } } catch {}
    }
    source = doc;
    // a ready-made, a guided draft or an AI draft names its roles (Client, Provider): one row per role, the role word as the placeholder
    if (!templateParam && !people.length && !pp?.people?.length && rolesOf(doc).length) people = rolesOf(doc).map((w, i) => ({ role: `signer_${i + 1}`, name: "", email: null, phone: null, action_role: "signer", external_ref: null, expires_at: null, reminder_days: null, assists_role: null, step: i + 1, roleWord: w }));
    // USING a template: one row per role, the role as the placeholder; a role the template says is "a fixed person" arrives filled in. EDITING one: its notes, message and send choices come back into the form.
    if (useMode) varValues = Object.fromEntries(variablesOf(doc).map((v) => [v.key, v.default ?? ""]));
    if (templateParam && tplDefaults) {
      const sd = tplDefaults.sendDefaults ?? {}, plays = sd.plays ?? {};
      if (mode === "document") people = rolesOf(doc).map((w, i) => ({ role: `signer_${i + 1}`, name: plays[w]?.plays === "fixed" ? plays[w].name ?? "" : "", email: plays[w]?.plays === "fixed" ? plays[w].email ?? null : null, phone: null, action_role: "signer", external_ref: null, expires_at: null, reminder_days: null, assists_role: null, step: i + 1, roleWord: w }));
      else {
        // EDITING or customizing a template: Who signs opens with its roles (R10-33), the role word as the row's name, not one empty row
        if (mode === "template" && !people.length) people = rolesOf(doc).map((w, i) => ({ role: `signer_${i + 1}`, name: w, email: null, phone: null, action_role: "signer", external_ref: null, expires_at: null, reminder_days: null, assists_role: null, step: i + 1, roleWord: w }));
        const days = JSON.stringify(sd.reminders?.on ? sd.reminders.days : []);
        tpl = { aiRules: tplDefaults.aiRules ?? "", internal: tplDefaults.description ?? "", about: tplDefaults.clientDescription ?? "", subject: sd.subject ?? "", message: tplDefaults.message ?? sd.message ?? "", reminders: REMINDER_CHOICES.find((x) => JSON.stringify(x.days) === days)?.id ?? "3_7", expiry: sd.expiry_days ?? 30 };
        sendOptions = { ...sendOptions, ...(sd.order ? { order: sd.order } : {}), plays };
      }
    }
    // the people the draft already knows: the wizard's answers fill Who signs in (names are the role words until the sender types real ones)
    if (pp?.people?.length) {
      people = pp.people.map((p, i) => ({ role: `signer_${i + 1}`, name: p.role, email: null, phone: null, action_role: p.action ?? "signer", external_ref: null, expires_at: null, reminder_days: null, assists_role: null, step: p.step ?? i + 1, roleWord: p.role }));
      sendOptions = { order: pp.signing_order === "sequential" ? "sequential" : "parallel" };
    }
    loading = false;
  }
  onMount(load);
  beforeNavigate((nav) => { if (dirty && !nav.willUnload && !confirm(t("You have unsaved changes. Leave without saving?"))) nav.cancel(); });
  const onUnload = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } };

  function changePeople(p) {
    if (p.parties) {
      const prev = new Map(people.map((x) => [x.role, x]));
      people = p.parties.map((x) => ({ ...x, roleWord: prev.get(x.role)?.roleWord, invented: prev.get(x.role)?.invented }));
    }
    if (p.sendOptions) sendOptions = { ...sendOptions, ...p.sendOptions };
    dirty = true;
  }

  // Entering Prepare: every person gets the word their fields and signature slots carry; the roles a ready-made or an AI draft already uses are matched to the people in order, and a role with nobody gets a person
  function enterPrepare() {
    const doc = prep.getSource ? prep.getSource() : source;
    const docRoles = rolesOf(doc), taken = new Set(); const map = new Map();
    const next = people.map((p) => ({ ...p }));
    const live = next.map((p, i) => ({ p, i }));
    for (const { p } of live) if (p.roleWord && docRoles.includes(p.roleWord)) taken.add(p.roleWord);
    const free = docRoles.filter((r) => !taken.has(r));
    for (const { p, i } of live) {
      const want = (p.name || "").trim() || p.roleWord || `Signer ${i + 1}`;
      if (p.invented && p.roleWord !== want) { const w = uniqueWord(want, next.map((x) => x.roleWord).filter((x) => x && x !== p.roleWord)); map.set(p.roleWord, w); p.roleWord = w; }
      else if (!p.roleWord) { const own = free.shift(); const w = own ?? uniqueWord(want, next.map((x) => x.roleWord).filter(Boolean)); p.roleWord = w; p.invented = !own; if (own) taken.add(own); }   // a role the document already names (Client, Provider) stays that word; the person's own name is shown beside it
    }
    for (const r of free.filter((r) => !next.some((p) => p.roleWord === r))) next.push({ role: `signer_${next.length + 1}`, name: "", email: null, phone: null, action_role: "signer", external_ref: null, expires_at: null, reminder_days: null, assists_role: null, step: next.length + 1, roleWord: r });
    people = next; source = map.size ? rewriteRoles(doc, map) : doc; step = "prepare";
  }

  async function finish() {
    attempted = true;
    if (ai && !ai.items.every((_, i) => ticks[i])) return;
    if (!name.trim()) { problem = t("Give it a name first."); return; }
    busy = true; problem = null;
    const src = prep.getSource(), facts = prep.getCustom();
    for (const v of vars) facts[`custom.${v.key}`] = String(varValues[v.key] ?? "");
    Object.assign(facts, personFacts(people));   // merge text: each person's own name and email
    const r = await api(`${ENGINE}/documents`, { method: "POST", body: { title: name.trim(), source: src, facts, paper, requireSignature: false, ...(vars.length ? { variableValues: Object.fromEntries(vars.map((v) => [v.key, String(varValues[v.key] ?? "")])) } : {}) } });
    if (!r.ok) { busy = false; problem = r.error ?? t("That could not be saved."); return; }
    const id = val(r).instanceId;
    // read the seats the engine made from the roles in the text, then give each person theirs
    const d = await api(`/api/documents/pdf/${id}`);
    if (!d.ok) { busy = false; problem = d.error ?? t("That could not be saved."); return; }
    const roles = d.json.body.roles ?? []; const used = new Set(); const seatOf = new Map();
    for (const p of people) { const hit = roles.find((x) => x.label === p.roleWord && !used.has(x.key)); if (hit) { used.add(hit.key); seatOf.set(p.role, hit.key); } }
    let n = 1; for (const p of people) if (!seatOf.has(p.role)) { while (used.has(`signer_${n}`)) n++; used.add(`signer_${n}`); seatOf.set(p.role, `signer_${n}`); }
    const re = (k) => seatOf.get(k) ?? k;
    const parties = people.map((p, i) => ({ role: re(p.role), name: p.name || p.roleWord || "", email: p.email ?? null, phone: p.phone ?? null, action_role: p.action_role ?? "signer", external_ref: p.external_ref ?? null, expires_at: null, reminder_days: null, assists_role: p.assists_role ? re(p.assists_role) : null, step: p.step ?? i + 1,
      ...((p.action_role ?? "signer") === "signer" && p.group_label ? { group_label: p.group_label } : {}), ...((p.action_role ?? "signer") === "signer" && p.witness_required ? { witness_required: true } : {}) }));   // Run 9 (F1046): a signing group and a witness chosen on Who signs are saved, not dropped
    const { plays: _plays, ...tplSend } = tplDefaults?.sendDefaults ?? {};
    const so = { ...tplSend, ...sendOptions, in_person: (sendOptions.in_person ?? []).map(re) };
    if (suggest?.subject) so.subject = suggest.subject;
    if (suggest?.message) so.message = suggest.message;
    const rem = REMINDER_CHOICES.find((x) => x.id === suggest?.reminders); if (rem?.days?.length) so.reminders = { on: true, days: rem.days };
    if (Number.isInteger(suggest?.expiry) && suggest.expiry >= 0) so.expiry_days = Math.min(365, suggest.expiry);
    const sv = await api("/api/documents/pdf/save", { method: "POST", body: { instanceId: id, body: d.json.body, parties, sendOptions: so, ...(templateParam && tplDefaults ? { description: tplDefaults.clientDescription ?? undefined, message: tplDefaults.message ?? undefined } : {}) } });
    busy = false;
    if (!sv.ok) { problem = sv.error ?? t("That could not be saved."); return; }
    dirty = false; clearDraft(); toast(t("Document created."), "ok"); await goto(`/documents/${id}/edit?step=details`);
  }
  async function saveTemplate() {
    attempted = true; if (!name.trim()) { problem = t("Give it a name first."); return; }
    busy = true; problem = null;
    const src = prep.getSource();
    const r = templateParam
      ? await api(`${ENGINE}/templates/version`, { method: "POST", body: { templateId: templateParam, source: src, requireSignature: false, ...(changeNote.trim() ? { changeNote: changeNote.trim() } : {}) } })
      : await api(`${ENGINE}/templates`, { method: "POST", body: { name: name.trim(), source: src, profile: "typeset", origin: "written", paper, requireSignature: false, kind: "document" } });
    if (!r.ok) { busy = false; if (await handleRefusal(r, { action: "create_template" })) return; problem = r.error ?? t("That could not be saved."); return; }
    const saved = val(r);
    const rem = REMINDER_CHOICES.find((x) => x.id === tpl.reminders);
    const plays = Object.fromEntries(people.filter((p) => p.roleWord).map((p) => [p.roleWord, { plays: sendOptions.plays?.[p.role] ?? "at_send", ...(sendOptions.plays?.[p.role] === "fixed" ? { name: p.name || undefined, email: p.email || undefined } : {}) }]));
    const sd = { ...(tpl.subject ? { subject: tpl.subject } : {}), ...(tpl.message ? { message: tpl.message } : {}), ...(rem?.days?.length ? { reminders: { on: true, days: rem.days } } : { reminders: { on: false, days: [3] } }), expiry_days: tpl.expiry, order: sendOptions.order ?? "parallel", plays };
    const d = await api(`${ENGINE}/templates/defaults`, { method: "POST", body: { templateId: saved.templateId, description: tpl.internal, clientDescription: tpl.about, message: tpl.message, sendDefaults: sd, aiRules: tpl.aiRules } });
    busy = false;
    if (!d.ok) { problem = d.error ?? t("The template was saved but its defaults were not."); return; }
    dirty = false; clearDraft(); toast(t("Template saved."), "ok"); await goto("/templates");
  }
  async function toCheck() {   // the template's preview: the real engine check, drawn per role
    busy = true; const r = await api(`${ENGINE}/check`, { method: "POST", body: { source: prep.getSource(), profile: "typeset", requireSignature: false } }); busy = false;
    chk = r.ok ? val(r) : { errors: [r.error ?? t("The check could not run.")], html: "", roles: [] };
    step = "check";
  }
  const TPL_ORDER = ["people", "prepare", "details", "check", "save"];
  let peopleTried = $state(false);
  const EMAIL_OK = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
  const vars = $derived(useMode ? variablesOf(source) : []);
  // using a template makes the document straight away: the page that holds the words has to be up before they can be read
  async function makeNow() { enterPrepare(); for (let i = 0; i < 100 && !prep.getSource; i++) await new Promise((r) => setTimeout(r, 50)); return finish(); }
  const next = () => {
    if (step === "people" && people.some((p) => p.email && !EMAIL_OK.test(p.email))) { peopleTried = true; return; }
    if (useMode) {
      if (step === "people") { if (vars.length) { step = "fill"; return; } return makeNow(); }
      if (step === "fill") { if (vars.some((v) => !String(varValues[v.key] ?? "").trim())) { varsTried = true; return; } return makeNow(); }
      return finish();
    }
    if (mode !== "template") return step === "people" ? enterPrepare() : finish();
    if (step === "people") return enterPrepare();
    if (step === "prepare") { step = "details"; return; }
    if (step === "details") return toCheck();
    if (step === "check") { step = "save"; return; }
    return saveTemplate();
  };
  const back = () => { if (step === "prepare" && prep.getSource) source = prep.getSource(); if (useMode && step === "prepare" && vars.length) { step = "fill"; return; } if (mode !== "template") { step = "people"; return; } step = TPL_ORDER[Math.max(0, TPL_ORDER.indexOf(step) - 1)]; };
  const tplRoles = $derived(people.map((p) => p.roleWord ?? p.name).filter(Boolean));
  const chkSrc = $derived(chk?.html !== undefined ? previewHtml(chk.html ?? "", { view: chkView, roles: tplRoles, asRole: chkAs, title: name || t("Template"), hash: chk.hash ?? "" }) : "");
  const allTicked = $derived(!ai || ai.items.every((_, i) => ticks[i]));
</script>
<svelte:head><title>{name || t("New document")} · Docustay</title></svelte:head>
<svelte:window onbeforeunload={onUnload} />
{#if resumed}<div class="notice info mb-3 flex flex-wrap items-center gap-3" data-testid="flow-resumed"><span>{t("Continuing your unsaved draft.")}</span><button class="btn !min-h-9 !py-1" onclick={startAgain} data-testid="flow-start-again">{t("Start again")}</button></div>{/if}
<PageHeader title={mode === "template" ? t("New document template") : t("New document")} back={{ href: mode === "template" ? "/templates" : "/documents", label: mode === "template" ? t("Templates") : t("All documents") }}>{#snippet filters()}<FlowSteps current={step} mode={useMode ? "use" : mode} hide={useMode && !vars.length ? ["fill"] : []} onpick={(id) => { if (id === "start") goto(`/create?mode=${mode}`); else if (id === "people") { if (step === "prepare" && prep.getSource) source = prep.getSource(); step = "people"; } else if (id === "fill" && useMode) { if (step === "prepare" && prep.getSource) source = prep.getSource(); step = "fill"; } else if (id === "prepare") { if (step === "people") enterPrepare(); else step = "prepare"; } }} />{/snippet}</PageHeader>
{#if capped}<div class="mt-3 mb-4" data-testid="flow-template-cap">{#await import("$lib/pro/TemplateUsage.svelte") then { default: TemplateUsage }}<TemplateUsage  />{/await}</div>{/if}
{#if loading}<PageSkel kind="flow" testid="flow-loading" />{:else}
  <div class="flex flex-wrap items-center gap-3">
    <input class="field !w-full min-w-0 text-lg font-semibold sm:!w-auto sm:flex-1" bind:value={name} oninput={() => (dirty = true)} placeholder={mode === "template" ? t("Template name") : t("Document title")} aria-label={mode === "template" ? t("Template name") : t("Document title")} data-testid="w-name" />
    {#if step !== "people"}<button class="btn" onclick={back} data-testid="flow-back">{t("Back")}</button>{/if}
    <button class="btn primary" disabled={busy} onclick={next} data-testid="flow-next">{step === "save" ? t("Save template") : t("Next")}</button>
  </div>
  {#if problem}<p class="mt-3 text-bad" role="alert" data-testid="flow-problem">{problem}{#if /Address line/.test(problem)} <a class="underline" href="/settings?tab=appearance" data-testid="flow-problem-settings">{t("Open Settings")}</a>{/if}</p>{/if}
  {#if ai}
    <div class="notice info mt-3" role="status" data-testid="w-ai-panel">
      <p class="font-semibold" data-testid="w-ai-finished">{t("{name} finished your document. Review it, AI can make mistakes.", { name: ai.agent })}</p>
      {#if ai.items.length}
        <p class="mt-2 text-sm">{t("What {name} assumed, and what to check. Tick each line once you have read it.", { name: ai.agent })}</p>
        <ul class="mt-2 grid gap-1 text-sm">{#each ai.items as it, i}<li><label class="flex items-start gap-2"><input type="checkbox" class="mt-1" bind:checked={ticks[i]} data-testid={`w-ai-tick-${i}`} /><span>{#if it.kind === "careful"}<b class="mr-1">{t("Check this carefully")}:</b>{/if}{#if it.kind === "question"}<b class="mr-1">{t("Question")}:</b>{/if}{it.text}</span></label></li>{/each}</ul>
      {/if}
    </div>
    {#if attempted && !allTicked}<p class="mt-3 text-bad" role="alert" data-testid="w-ai-untick">{t("Tick each line above once you have read it.")}</p>{/if}
  {/if}
  <div class="mt-4" {@attach stepMotion}>
    {#if step === "people"}
      <PeopleStep doc={docState} attempted={peopleTried} onChange={changePeople} mode={mode === "template" ? "template" : "flow"} />
    {:else}
      {#if step === "fill"}{#await import("$lib/flow/FillDetails.svelte") then { default: FillDetails }}<FillDetails {vars} bind:values={varValues} tried={varsTried} />{/await}{/if}
      <div class:hidden={step !== "prepare"}>{#key mode}{#await import("$lib/flow/PrepareWritten.svelte") then { default: PrepareWritten }}<PrepareWritten initial={source} initialCustom={savedCustom} {people} {mode} onchange={() => { dirty = true; edits++; }} bind:api={prep} />{/await}{/key}</div>
      {#if step === "details"}{#await import("$lib/flow/TemplateDetails.svelte") then { default: TemplateDetails }}<TemplateDetails bind:tpl />{/await}
      {:else if step === "check"}
        <div class="pg-split pg-split-left" style="--aside: 20rem" data-testid="template-check">
          <div class="space-y-3">
            {#if (chk?.errors ?? []).length}{#each chk.errors as e}<p class="text-sm text-bad">{msg(e)}</p>{/each}{:else}<p class="text-sm">{t("Nothing to fix.")}</p>{/if}
            {#each chk?.warnings ?? [] as w}<p class="text-sm text-mute">{msg(w)}</p>{/each}
            <div class="flex gap-1.5">{#each [["see_it", "As they will see it"], ["as_signed", "As signed"], ["after_signing", "After signing"]] as [id, label]}<button class="btn !min-h-10 !px-3 {chkView === id ? 'primary' : ''}" onclick={() => (chkView = id)} data-testid={`tc-view-${id}`}>{id === "see_it" ? t("As they will see it") : id === "as_signed" ? t("As signed") : t("After signing")}</button>{/each}</div>
            <Pick options={[{ value: "", label: t("Everyone") }, ...tplRoles.map((r, i) => ({ value: r, label: r, dot: SEAT_COLOURS[i % SEAT_COLOURS.length] }))]} value={chkAs} onchange={(v) => (chkAs = v)} label={t("View as")} testid="tc-viewas" />
          </div>
          <iframe title={t("Preview")} class="h-[560px] w-full rounded-xl border border-line bg-white" sandbox="" srcdoc={chkSrc} data-testid="tc-frame"></iframe>
        </div>
      {:else if step === "save"}
        <div class="space-y-3" data-testid="template-save">
          <p class="text-sm text-mute">{templateParam ? t("This saves a new version. Documents already sent are not changed.") : t("This saves the template. You can send documents from it any time.")}</p>
          {#if templateParam}<input class="field" bind:value={changeNote} placeholder={t("What changed? (optional)")} aria-label={t("What changed?")} data-testid="w-note" />{/if}
        </div>
      {/if}
    {/if}
  </div>
{/if}

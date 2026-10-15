<script>
  import ProLock from "$lib/pro/ProLock.svelte";
  import { entitled, loadPlan } from "$lib/pro/plan.svelte.js";
  import Building from "$lib/fx/Building.svelte";
  import { onMount, untrack } from "svelte";
  import { loadPdf } from "$lib/pdf.js";
  import PdfPage from "$lib/PdfPage.svelte";
  import { TOOLS, FIELD_DEFAULTS, seatColour, newField, fromSuggestion, detectionSummary, clamp, snap, resized } from "./fields.js";
  import { t, td } from "$lib/i18n/index.svelte.js";
  import { tl } from "$lib/flow/flowLabels.js";
  import { FILLED_BY } from "$lib/flow/flowDefinition.js";
  import Palette from "$lib/flow/Palette.svelte";
  import Seg from "$lib/flow/Seg.svelte";
  import OptionEditor from "$lib/flow/OptionEditor.svelte";
  import { isMark } from "$lib/flow/palette.js";
  import { FIELD_MIME } from "./sourceEditor.js";
  import Pick from "$lib/ui/Pick.svelte";
  import { api } from "$lib/api.js";
  import FlowIcon from "$lib/flow/FlowIcon.svelte";
  import RuleEditor from "$lib/rules/RuleEditor.svelte";
  import { resolveFormula } from "$lib/rules/rules.js";
  let { doc, fileUrl, onChange, focusField = null } = $props();   // Run 9: the Check step's "Fix" opens Prepare with that box chosen and in view
  const body = doc.body;
  let fields = $state(JSON.parse(JSON.stringify(body.fields ?? []))), suggestions = $state(JSON.parse(JSON.stringify(body.suggestions ?? []))), selected = $state(untrack(() => focusField)), tool = $state(null);   // the box Fix chose, read once when Prepare opens
  let seat = $state(doc.parties?.find((p) => !["viewer", "cc", "approver"].includes(p.action_role))?.role ?? doc.parties?.[0]?.role ?? body.roles?.[0]?.key ?? "signer_1"), pdf = $state(null), error = $state(null), width = $state(720), holder = $state(null), vw = $state(1024);
  const phone = $derived(vw < 768);
  let undoStack = [], redoStack = [];
  const seats = $derived(doc.parties?.length ? doc.parties.filter((p) => !['viewer', 'cc', 'approver'].includes(p.action_role)).map((p) => { const w = body.roles?.find((r) => r.key === p.role)?.label; return { key: p.role, label: w && p.name && p.name !== w ? `${w} (${p.name})` : (p.name || w || String(p.role).replace(/^signer_(\d+)$/, (_, n) => t("Signer {n}", { n }))) }; }).filter((x, i, all) => all.findIndex((y) => y.key === x.key) === i) : body.roles);   // R10-55: a signing group is several people in ONE seat: list the seat once
  const sel = $derived(fields.find((f) => f.id === selected));
  const snapshot = () => JSON.stringify({ fields, suggestions });
  function commit() { undoStack.push(prev); if (undoStack.length > 100) undoStack.shift(); redoStack = []; prev = snapshot(); report(); }
  let prev = snapshot();
  // A label is at most 120 characters; a longer one that arrives another way (paste, AI) is cut and said so, never sent to fail on the schema.
  function clampLabels(fs) { return fs.map((f) => { if (typeof f.label === "string" && f.label.length > 120) { lookMsg = t("A field label can be at most 120 characters."); return { ...f, label: f.label.slice(0, 120) }; } return f; }); }
  // Run 9: rules on whole pages of the file ("show page 3 when …"); kept with the body as page_rules
  let pageRules = $state(JSON.parse(JSON.stringify(body.page_rules ?? []))), ruleOpenFor = $state(null);
  const report = () => onChange({ ...body, roles: body.roles, fields: clampLabels($state.snapshot(fields)), suggestions: $state.snapshot(suggestions), page_rules: $state.snapshot(pageRules).filter((r) => r.show_when) });
  // who acts when: a rule may read only the sender's locked boxes or boxes of people who act EARLIER (the server checks again at Send, against the real order)
  const stepOf = (role) => { const ps = (doc.parties ?? []).filter((p) => p.role === role); return ps.length ? Math.min(...ps.map((p) => p.position ?? 1)) : Number(String(role).replace(/\D/g, "")) || 1; };
  const READABLE = new Set(["text", "checkbox", "dropdown", "multiselect"]);
  const ruleChoices = (step, exceptId = null, exceptPage = null) => fields.filter((f) => f.id !== exceptId && READABLE.has(f.type) && (exceptPage === null || f.page !== exceptPage || f.locked) && (f.locked || stepOf(f.role) < step)).map((f) => ({ id: f.id, label: f.label || f.id, type: f.type }));
  const pageStep = (n) => { const s = fields.filter((f) => f.page === n && !f.locked).map((f) => stepOf(f.role)); return s.length ? Math.min(...s) : Number.MAX_SAFE_INTEGER; };
  const setPageRule = (n, rule) => { pageRules = [...pageRules.filter((r) => r.page !== n), ...(rule ? [{ page: n, show_when: rule }] : [])]; report(); };
  // "works itself out": the formula is kept with ids; the person reads and writes it with [labels]
  const formulaShown = (src) => String(src ?? "").replace(/[A-Za-z_][A-Za-z0-9_-]*/g, (w) => { if (["round", "min", "max"].includes(w)) return w; const f = fields.find((x) => x.id === w); return f ? `[${f.label || f.id}]` : w; });
  let calcMsg = $state(null);
  function setCalc(f, text) {
    calcMsg = null;
    if (!text.trim()) { patch(f.id, { calc: undefined, places: undefined }); commit(); return; }
    const byName = (n) => fields.find((x) => x.id !== f.id && ((x.label || "").toLowerCase() === n.toLowerCase() || x.id === n))?.id ?? null;
    try { patch(f.id, { calc: resolveFormula(text, byName), required: false, locked: undefined }); commit(); }
    catch (e) { const m = /no field called “(.+)”/.exec(e.message); calcMsg = m ? t("There is no field called “{name}”.", { name: m[1] }) : t("That formula could not be read. Use numbers, [field names], + − × ÷, brackets, round(), min() and max()."); }
  }
  function restore(s) { const o = JSON.parse(s); fields = o.fields; suggestions = o.suggestions; prev = s; selected = fields.some((f) => f.id === selected) ? selected : null; report(); }
  const undo = () => { if (!undoStack.length) return; redoStack.push(prev); restore(undoStack.pop()); };
  const redo = () => { if (!redoStack.length) return; undoStack.push(prev); restore(redoStack.pop()); };
  onMount(async () => {
    try { const r = await fetch(fileUrl, { credentials: "same-origin" }); if (!r.ok) throw new Error(`(${r.status})`); pdf = await loadPdf(await r.arrayBuffer()); } catch (e) { error = e.message; }
  });
  $effect(() => { if (!holder) return; const f = () => { width = Math.max(280, Math.min(900, holder.clientWidth - 24)); }; f(); const ro = new ResizeObserver(f); ro.observe(holder); return () => ro.disconnect(); });
  const pageH = (n) => Math.round(width * (body.file.pages[n - 1].h / body.file.pages[n - 1].w));
  function place(e, n) {
    if (!tool || phone) { selected = null; return; }
    const r = e.currentTarget.getBoundingClientRect(), d = FIELD_DEFAULTS[tool];
    const f = newField(tool, seat, n, snap((e.clientX - r.left) / r.width - d.w / 2, e.altKey), snap((e.clientY - r.top) / r.height - d.h / 2, e.altKey));
    fields = [...fields, f]; selected = f.id; tool = null; commit();
  }
  // PREPARE on an uploaded file: a tile drags onto a page or is clicked once to land in the middle of the page being looked at; "Fields are for" is the default person; "View as" dims everyone else's boxes
  let viewAs = $state("everyone"), full = $state(false);
  const seatName = (role) => seats.find((s) => s.key === role)?.label || role;
  const seatOpts = $derived(seats.map((s) => ({ value: s.key, label: s.label || s.key, dot: seatColour(s.key) })));
  const viewOpts = $derived([{ value: "everyone", label: t("Everyone") }, { value: "sender", label: t("Sender") }, ...seatOpts]);
  const dim = (f) => viewAs === "sender" || (viewAs !== "everyone" && f.role !== viewAs);
  function addField(type, n, cx, cy) {
    const d = FIELD_DEFAULTS[type]; const f = newField(type, seat, n, snap(cx - d.w / 2), snap(cy - d.h / 2));
    fields = [...fields, f]; selected = f.id; commit();
  }
  function visiblePage() {   // the page whose middle is nearest the middle of what is on screen
    const hr = holder?.getBoundingClientRect(); if (!hr) return 1; const mid = hr.top + hr.height / 2; let best = 1, bd = Infinity;
    holder.querySelectorAll("[data-surface]").forEach((el, i) => { const r = el.getBoundingClientRect(); const d = Math.abs(r.top + r.height / 2 - mid); if (d < bd) { bd = d; best = i + 1; } });
    return best;
  }
  // D-037: a mouse click on a tile ARMS it and the next click on a page puts the field centred where that click lands; a keyboard press (or a phone) still puts it in the middle of the page being looked at
  const clickAdd = (type, e) => { if (!phone && e && e.detail > 0) { tool = tool === type ? null : type; return; } addField(type, visiblePage(), 0.5, 0.4); };
  const dragStart = (e, type) => { e.dataTransfer.setData(FIELD_MIME, type); e.dataTransfer.setData("text/plain", type); e.dataTransfer.effectAllowed = "copy"; };
  const dragOver = (e) => { if (e.dataTransfer?.types?.includes(FIELD_MIME)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } };
  function drop(e, n) { const type = e.dataTransfer?.getData(FIELD_MIME); if (!type) return; e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); addField(type, n, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height); }
  let drag = null;
  function down(e, f, mode) {
    if (phone) return; e.stopPropagation(); e.preventDefault(); selected = f.id;
    const surface = e.currentTarget.closest("[data-surface]"), r = surface.getBoundingClientRect();
    drag = { id: f.id, mode, sx: e.clientX, sy: e.clientY, w: r.width, h: r.height, orig: { ...f }, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function move(e) {
    if (!drag) return; const dx = (e.clientX - drag.sx) / drag.w, dy = (e.clientY - drag.sy) / drag.h; if (Math.abs(dx) + Math.abs(dy) > 0.001) drag.moved = true;
    const next = drag.mode === "move" ? clamp({ ...drag.orig, x: drag.orig.x + dx, y: drag.orig.y + dy }) : resized(drag.orig, drag.mode, dx, dy);
    fields = fields.map((f) => (f.id === drag.id ? next : f));
  }
  function up() { if (!drag) return; const d = drag; drag = null; if (d.moved) { fields = fields.map((f) => (f.id === d.id ? { ...f, x: snap(f.x), y: snap(f.y), w: snap(f.w), h: snap(f.h) } : f)); commit(); } }
  function patch(id, p) { fields = fields.map((f) => (f.id === id ? clamp({ ...f, ...p }) : f)); }
  const remove = (id) => { fields = fields.filter((f) => f.id !== id); if (selected === id) selected = null; commit(); };
  const duplicate = (id, toPage = null) => { const f = fields.find((x) => x.id === id); if (!f) return; const c = clamp({ ...f, id: crypto.randomUUID().slice(0, 8), page: toPage ?? f.page, ...(toPage ? {} : { x: f.x + 0.02, y: f.y + 0.02 }) }); fields = [...fields, c]; selected = c.id; commit(); };
  const roleKeys = $derived((body.roles ?? []).map((r) => r.key));
  const found = $derived(detectionSummary(suggestions));
  let looking = $state(false), lookMsg = $state(null), splitting = $state(false);
  const refPages = $derived((body.detect?.pages ?? []).filter((p) => p.kind === "reference").map((p) => p.page));
  const formDocs = $derived((body.detect?.documents ?? []).filter((d) => d.kind === "form").length);
  const packet = $derived(formDocs > 1 || (formDocs >= 1 && refPages.length > 0));
  async function splitIt() {
    splitting = true; lookMsg = null;
    const r = await api("/api/documents/pdf/split-packet", { method: "POST", body: { instanceId: doc.id } }); splitting = false;
    const d = r.json?.data ?? r.json;
    if (!r.ok) { lookMsg = r.error ?? t("That file could not be split."); return; }
    window.location.assign(`/documents/${d.instanceId}/edit`);   // a full load: the editor keeps the old document in memory when only the id in the address changes
  }
  let finding = $state(false);
  async function findFields() {
    finding = true; lookMsg = null;
    const r = await api("/api/documents/pdf/find-fields", { method: "POST", body: { instanceId: doc.id } }); finding = false;
    const d = r.json?.data ?? r.json;
    if (!r.ok) { lookMsg = r.error ?? t("That file could not be read for fields."); return; }
    suggestions = d.suggestions ?? []; onChange({ ...body, roles: d.roles ?? body.roles, fields: clampLabels($state.snapshot(fields)), suggestions: $state.snapshot(suggestions), page_rules: $state.snapshot(pageRules).filter((r) => r.show_when) }); prev = snapshot();
    lookMsg = suggestions.length ? null : t("No blanks were found on these pages. Add fields by hand.");
  }
  // "Find fields with AI": a background job on the server, one task per page in parallel. This polls it, shows how far it is, and applies the result when it is done. Nothing is placed until the person accepts.
  let aiAllowed = $state(false), aiJob = $state(null), aiRun = 0;
  onMount(() => { loadPlan(); });
  // the chosen box is scrolled into view once its page has drawn (pages draw as they load)
  onMount(() => { if (!focusField) return; let n = 0; const iv = setInterval(() => { const el = document.querySelector(`[data-testid="placed-field"][data-field-id="${CSS.escape(focusField)}"]`); if (el || ++n > 40) { clearInterval(iv); el?.scrollIntoView({ block: "center", behavior: "smooth" }); } }, 150); return () => clearInterval(iv); });
  onMount(async () => { try { const r = await api("/api/documents/chat/status"); const d = r.json?.data ?? r.json; aiAllowed = d?.allowed === true; } catch { aiAllowed = false; } });
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  async function findWithAi() {
    looking = true; lookMsg = null; aiJob = null; const run = ++aiRun;
    const r = await api("/api/documents/pdf/find-fields/ai", { method: "POST", body: { instanceId: doc.id } });
    const d = r.json?.data ?? r.json;
    if (!r.ok) { looking = false; lookMsg = r.error ?? t("The AI could not look at this file."); return; }
    if (run !== aiRun) { api("/api/documents/pdf/find-fields/ai/cancel", { method: "POST", body: { jobId: d.jobId } }); return; }
    aiJob = { id: d.jobId, state: "queued", pagesDone: 0, pagesTotal: d.pagesTotal };
    const t0 = Date.now();
    while (aiJob && run === aiRun && !["done", "failed", "cancelled"].includes(aiJob.state)) {
      await sleep(1500);
      if (Date.now() - t0 > 240000) { looking = false; lookMsg = t("The AI is taking too long. The program's own result is kept."); aiJob = null; return; }
      const p = await api(`/api/documents/pdf/find-fields/ai/${aiJob.id}`); if (!p.ok) continue;
      if (run !== aiRun) return;
      aiJob = p.json?.data ?? p.json;
    }
    if (run !== aiRun) return;   // Cancel already ended this run
    const job = aiJob; aiJob = null;
    if (!job || job.state === "cancelled") { looking = false; lookMsg = t("Cancelled."); return; }
    if (job.state === "failed") { looking = false; lookMsg = job.message ?? t("The AI could not read these pages. The program's own result is kept."); return; }
    const ap = await api("/api/documents/pdf/find-fields/ai/apply", { method: "POST", body: { jobId: job.id } }); looking = false;
    const a = ap.json?.data ?? ap.json;
    if (!ap.ok) { lookMsg = ap.error ?? t("The AI could not look at this file."); return; }
    suggestions = a.suggestions ?? []; onChange({ ...body, roles: a.roles ?? body.roles, fields: clampLabels($state.snapshot(fields)), suggestions: $state.snapshot(suggestions), page_rules: $state.snapshot(pageRules).filter((r) => r.show_when) }); prev = snapshot();
    lookMsg = suggestions.length ? t("{n, plural, one {The AI checked # page} other {The AI checked # pages}}. Used {x} credits.", { n: job.pagesDone, x: job.credits }) : t("No blanks were found on these pages. Add fields by hand.");
  }
  async function cancelAi() { if (!aiJob) return; const id = aiJob.id; aiRun++; aiJob = null; looking = false; lookMsg = t("Cancelled."); await api("/api/documents/pdf/find-fields/ai/cancel", { method: "POST", body: { jobId: id } }); }
  const accept = (s) => { fields = [...fields, fromSuggestion(s, seat, roleKeys)]; suggestions = suggestions.filter((x) => x.id !== s.id); commit(); };
  const acceptAll = () => { const add = suggestions.map((s) => fromSuggestion(s, seat, roleKeys)); fields = [...fields, ...add]; suggestions = []; commit(); };
  function key(e) {
    const tag = e.target?.tagName; if (["INPUT", "TEXTAREA", "SELECT"].includes(tag)) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); }
    else if (mod && e.key.toLowerCase() === "d" && selected) { e.preventDefault(); duplicate(selected); }
    else if ((e.key === "Delete" || e.key === "Backspace") && selected) { e.preventDefault(); remove(selected); }
    else if (e.key === "Escape") { tool = null; selected = null; full = false; }
    else if (selected && e.key.startsWith("Arrow")) { e.preventDefault(); const s = 0.002, f = fields.find((x) => x.id === selected); patch(selected, { x: f.x + (e.key === "ArrowRight" ? s : e.key === "ArrowLeft" ? -s : 0), y: f.y + (e.key === "ArrowDown" ? s : e.key === "ArrowUp" ? -s : 0) }); clearTimeout(nudgeT); nudgeT = setTimeout(commit, 400); }
  }
  let nudgeT;
  const payKind = (f) => (f.amount_ask !== undefined ? "ask" : f.amount_formula !== undefined ? "formula" : f.price_id !== undefined ? "price" : f.payment_link !== undefined ? "link" : f.amount_from !== undefined ? "custom" : "fixed");
  const setPayKind = (f, k) => {   // exactly one way of setting the amount: switching clears the others
    const blank = { amount_minor: undefined, amount_from: undefined, amount_formula: undefined, price_id: undefined, payment_link: undefined, amount_ask: undefined, deposit: undefined, plan: undefined };
    patch(f.id, { ...blank, ...(k === "fixed" ? { amount_minor: 5000 } : k === "ask" ? { amount_ask: {} } : k === "formula" ? { amount_formula: "1" } : k === "price" ? { price_id: "price_ReplaceThis" } : k === "link" ? { payment_link: "https://buy.stripe.com/replace_this" } : {}) }); commit();
  };
  // how a FIXED amount is collected: all at once, a deposit now, installments, or every period until cancelled
  const fixedMode = (f) => (f.deposit ? "deposit" : f.plan ? (f.plan.count ? "installments" : "subscription") : "once");
  const setFixedMode = (f, m) => { patch(f.id, { deposit: m === "deposit" ? { percent: 25 } : undefined, plan: m === "installments" ? { every: "month", count: 6 } : m === "subscription" ? { every: "month" } : undefined }); commit(); };
  const askBound = (f, key, v) => { const n = Math.round(Number(v) * 100); const a = { ...(f.amount_ask ?? {}) }; if (v === "" || !(n >= 50)) delete a[key]; else a[key] = n; patch(f.id, { amount_ask: a }); commit(); };
</script>
<svelte:window bind:innerWidth={vw} onkeydown={key} onpointermove={move} onpointerup={up} />
{#if error}<p class="text-bad" role="alert">{t("The pages could not be shown {error}. Reload to try again.", { error })}</p>{:else}
<div class="grid gap-4 md:grid-cols-[190px_minmax(0,1fr)_250px] {full ? 'fixed inset-0 z-40 overflow-auto bg-paper p-4' : ''}" data-testid="fields-step" data-full={full ? "1" : "0"}>
  <aside class="space-y-3" aria-label={t("Field tools")}>
    {#if phone}<p class="rounded-lg bg-tint p-3 text-sm text-mute">{t("Placing fields needs a bigger screen — edit on desktop. You can still look at the pages.")}</p>
    {:else}
      <Pick options={seatOpts} value={seat} onchange={(v) => (seat = v)} label={t("Fields are for")} testid="pp-for" />
      <Seg options={viewOpts} value={viewAs} onchange={(v) => (viewAs = v)} label={t("View as")} testid="pp-view" />
      <button class="btn !min-h-9 !py-1 text-sm" onclick={() => (full = !full)} aria-pressed={full} data-testid="pp-full">{full ? t("Exit full screen") : t("Full screen")}</button>
      <Palette onadd={clickAdd} ondragstart={dragStart} prefix="tool" armed={tool} hint={t("Drag onto a page, or click it and then click where it goes")} />
      <p class="text-xs text-mute">{tool ? t("Now click on the page where it goes. Escape cancels.") : t("Drag a field onto a page, or click it and then click on the page where it goes.")}</p>
      <div class="flex gap-1.5"><button class="btn !py-1 !text-sm" onclick={undo} data-testid="fields-undo">{t("Undo")}</button><button class="btn !py-1 !text-sm" onclick={redo}>{t("Redo")}</button></div>
      <button class="btn !text-sm" onclick={findFields} disabled={finding} data-testid="find-fields">{finding ? t("Looking for fields…") : t("Find fields")}</button>
      {#if aiAllowed}<button class="btn !text-sm" onclick={findWithAi} disabled={looking || finding} data-testid="find-fields-ai">{looking ? t("Looking…") : t("Find fields with AI")}</button>{/if}
      {#if aiJob}<Building kind="fields" label={t("Finding the fields on each page")} done={aiJob.pagesDone} total={aiJob.pagesTotal || null} testid="find-building" /><p class="text-xs text-mute" role="status" data-testid="find-progress">{t("{total, plural, one {Finding fields {done} of # page} other {Finding fields {done} of # pages}}", { done: aiJob.pagesDone, total: aiJob.pagesTotal })} <button class="underline" onclick={cancelAi} data-testid="find-cancel">{t("Cancel")}</button></p>{/if}
      {#if lookMsg}<p class="text-xs text-mute" data-testid="find-msg">{lookMsg}</p>{/if}
      {#if suggestions.length}<button class="btn !text-sm" onclick={acceptAll} data-testid="fields-accept-all">{t("Accept all {n} suggestions", { n: suggestions.length })}</button>{/if}
    {/if}
  </aside>
  <div class="min-w-0">
  {#if found && suggestions.length}<p class="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-tint px-3 py-2 text-sm" data-testid="detect-banner"><span>{#if body.suggestions?.some((s) => s.source === "remembered")}{t("This form has been sent before: its boxes are back where they were.")}{" "}{/if}{#if (suggestions ?? []).find((s) => s.knownForm) ?? body.suggestions?.find((s) => s.knownForm)}<span data-testid="detect-known">{t("Recognised: {form}. Its boxes are where the form puts them.", { form: ((suggestions ?? []).find((s) => s.knownForm) ?? body.suggestions.find((s) => s.knownForm)).knownForm })}</span>{" "}{/if}{t("{n, plural, one {Found # field} other {Found # fields}}, {s, plural, one {# signer} other {# signers}}", { n: found.fields, s: found.signers })}{#if found.low}; {t("{n} not sure about", { n: found.low })}{/if}. {t("Nothing is placed until you accept it.")}</span>{#if !phone && aiAllowed}<button class="btn !min-h-8 !py-0.5 text-sm" onclick={findWithAi} disabled={looking} data-testid="detect-ai">{looking ? t("Looking…") : t("Check with AI")}</button><button class="btn primary !min-h-8 !py-0.5 text-sm" onclick={acceptAll} data-testid="detect-accept-all">{t("Accept all")}</button>{/if}</p>{/if}{#if packet && !phone}<p class="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-tint px-3 py-2 text-sm" data-testid="detect-packet"><span>{#if formDocs > 1}{t("{n} forms in one file.", { n: formDocs })}{" "}{/if}{#if refPages.length}{t("{n, plural, one {# page is a reference page} other {# pages are reference pages}}", { n: refPages.length })}: {refPages.join(", ")}. {t("Nothing to fill there; they can travel as attachments.")}{/if}</span><button class="btn !min-h-8 !py-0.5 text-sm" onclick={splitIt} disabled={splitting} data-testid="detect-split">{splitting ? t("Splitting…") : t("Split into documents")}</button></p>{/if}{#if lookMsg}<p class="mb-2 text-sm text-mute" role="status" data-testid="detect-ai-note">{lookMsg}</p>{/if}
  <div bind:this={holder} class="min-w-0 space-y-4 overflow-auto rounded-xl border border-line bg-tint p-3" style="max-height:{full ? 'calc(100vh - 2rem)' : 'calc(100vh - 220px)'}" data-testid="fields-pages">
    {#if !pdf}<p class="p-8 text-center text-mute">{t("Loading pages…")}</p>{:else}
      {#each Array.from({ length: body.file.page_count }, (_, i) => i + 1) as n}
        {@const pr = pageRules.find((r) => r.page === n)}
        <div><p class="mb-1 flex items-center gap-2 text-xs text-mute">{t("Page {n} of {total}", { n, total: body.file.page_count })}{#if body.file.page_count > 1 && !phone}<button type="button" class="underline" onclick={() => (ruleOpenFor = ruleOpenFor === n ? null : n)} data-testid={`page-rule-toggle-${n}`}>{pr ? t("Shown only when a rule holds") : t("Show this page only when…")}</button>{/if}</p>
          {#if ruleOpenFor === n}<div class="mb-2 max-w-md rounded-lg border border-line bg-card p-2" data-testid={`page-rule-${n}`}><RuleEditor rule={pr?.show_when ?? null} choices={ruleChoices(pageStep(n), null, n)} onchange={(r) => setPageRule(n, r)} testid={`page-rule-${n}-ed`} note={t("When the rule does not hold, the whole page is left out for the people after, and from the signed copy.")} /></div>{/if}
          <PdfPage {pdf} pageNumber={n} {width}>
            <div class="absolute inset-0" data-surface style="cursor:{tool && !phone ? 'crosshair' : 'default'}" role="presentation" onclick={(e) => place(e, n)} ondragover={dragOver} ondrop={(e) => drop(e, n)} data-testid="page-surface-{n}">
              {#each suggestions.filter((s) => s.page === n) as s (s.id)}
                {@const sc = s.role ? seatColour(s.role) : null}
                <button type="button" class="absolute border-2 border-dashed {sc ? '' : 'border-warn-line bg-amber-300/20'} text-left text-xs" style="left:{s.x * 100}%;top:{s.y * 100}%;width:{s.w * 100}%;height:{s.h * 100}%;{sc ? `border-color:${sc};background:${sc}1f;color:${sc}` : ''};{s.confidence != null && s.confidence < 0.6 ? 'opacity:.75;border-style:dotted' : ''}" title={s.why ?? t("Suggested")} onclick={(e) => { e.stopPropagation(); if (!phone) accept(s); }} data-testid="suggestion" data-confidence={s.confidence ?? ""} data-role={s.role ?? ""}><span class="px-0.5">+ {s.label || s.type.replace("_", " ")}{#if s.confidence != null && s.confidence < 0.6} ?{/if}</span></button>
              {/each}
              {#each fields.filter((f) => f.page === n) as f (f.id)}
                {@const c = seatColour(f.role)}
                <div class="absolute select-none" style="opacity:{dim(f) ? 0.3 : 1};left:{f.x * 100}%;top:{f.y * 100}%;width:{f.w * 100}%;height:{f.h * 100}%;touch-action:none" data-testid="placed-field" data-field-id={f.id} data-type={f.type}
                  onpointerdown={(e) => down(e, f, "move")} onclick={(e) => e.stopPropagation()} role="button" tabindex="0">
                  <div class="flex h-full w-full cursor-move items-center justify-between overflow-hidden px-1 text-xs" style="background:{c}22;border:1.5px solid {c};outline:{selected === f.id ? `2px solid ${c}` : 'none'};color:{c}"><span class="truncate">{f.label || f.type} · {seatName(f.role)}</span>{#if f.show_when}<span title={t("Shown only when a rule holds")} aria-label={t("Shown only when a rule holds")}>◐</span>{/if}{#if f.calc}<span title={t("Works itself out")} aria-label={t("Works itself out")}>ƒ</span>{/if}{#if f.required}<span aria-hidden="true">*</span>{/if}</div>
                  {#if selected === f.id && !phone}{#each ["nw", "ne", "sw", "se"] as d}<span class="absolute size-2.5 rounded-sm border border-white" style="background:{c};{d.includes('n') ? 'top:-5px' : 'bottom:-5px'};{d.includes('w') ? 'left:-5px' : 'right:-5px'};cursor:{d === 'nw' || d === 'se' ? 'nwse-resize' : 'nesw-resize'}" onpointerdown={(e) => down(e, f, d)} role="presentation" data-handle={d}></span>{/each}{/if}
                </div>
              {/each}
            </div>
          </PdfPage></div>
      {/each}
    {/if}
  </div>
  </div>
  <aside class="space-y-3" aria-label={t("Field settings")} data-testid="fields-inspector">
    {#if !sel}<p class="text-sm text-mute">{fields.length ? t("{n, plural, one {# field placed. Select it to change it.} other {# fields placed. Select one to change it.}}", { n: fields.length }) : t("No fields yet. Pick a tool on the left, or accept the suggestions.")}</p>
      <ul class="space-y-1.5" data-testid="pp-people-panel">{#each seats as s (s.key)}<li class="flex items-center gap-2 text-sm"><span class="inline-block size-2.5 rounded-full" style="background:{seatColour(s.key)}"></span>{s.label || s.key}</li>{/each}</ul>
    {:else}
      <div><p class="mb-1 text-xs text-mute">{t("Label")}</p><input class="field !py-1.5" value={sel.label ?? ""} maxlength="120" oninput={(e) => patch(sel.id, { label: e.currentTarget.value })} onchange={commit} aria-label={t("Field label")} data-testid="field-label" /></div>
      <div><p class="mb-1 text-xs text-mute">{t("Belongs to")}</p><select class="field !py-1.5" value={sel.role} onchange={(e) => { patch(sel.id, { role: e.currentTarget.value }); commit(); }} aria-label={t("Field belongs to")}>{#each seats as s}<option value={s.key}>{s.label}</option>{/each}</select></div>
      <!-- Run 9 (R8-57): "Sender first" — you give the answer before sending; the person signing sees it and cannot change it (a signature, a tick or a payment is always theirs) -->
      <div><Seg options={FILLED_BY.map((o) => ({ value: o.id, label: tl(o.label) }))} value={sel.sender ? "sender" : "signer"} onchange={(v) => { patch(sel.id, v === "sender" ? { sender: true, locked: undefined, autofill: undefined, editable: undefined, calc: undefined } : { sender: undefined }); commit(); }} label={t("Filled in by")} testid="pp-filledby" disabled={!["text", "dropdown", "multiselect"].includes(sel.type)} />
        {#if sel.sender}<p class="mt-1 text-xs text-mute">{tl("You fill it in before sending; signers see it but cannot change it.")}</p>
          {#if sel.type === "text"}<div class="mt-2"><p class="mb-1 text-xs text-mute">{t("Your answer")}</p><input class="field !py-1.5" value={sel.default ?? ""} oninput={(e) => patch(sel.id, { default: e.currentTarget.value || undefined })} onchange={commit} aria-label={t("Your answer")} data-testid="pp-sender-value" />{#if /\{\{/.test(sel.default ?? "")}<p class="mt-1 text-xs text-mute">{t("Filled in from your organisation's details when you send. Type over it to use your own words.")}</p>{/if}</div>{/if}
        {:else if !["text", "dropdown", "multiselect"].includes(sel.type)}<p class="mt-1 text-xs text-mute">{t("The person signing fills this in.")}</p>{/if}</div>
      <label class="flex items-center justify-between text-sm">{t("Required")} <input type="checkbox" checked={sel.type === "payment" ? true : sel.required} disabled={sel.type === "payment"} onchange={(e) => { patch(sel.id, { required: e.currentTarget.checked }); commit(); }} /></label>
      {#if sel.autofill}<label class="flex items-center justify-between text-sm">{t("Signer can change it")} <input type="checkbox" checked={sel.editable === true} onchange={(e) => { patch(sel.id, { editable: e.currentTarget.checked ? true : undefined }); commit(); }} data-testid="pp-editable" /></label>{/if}
      {#if sel.type === "text" && !sel.autofill}
        <div><p class="mb-1 text-xs text-mute">{t("Format")}</p><select class="field !py-1.5" value={sel.validation ?? "none"} onchange={(e) => { patch(sel.id, { validation: e.currentTarget.value }); commit(); }} aria-label={t("Format")}>{#each ["none", "email", "phone", "number", "date", "zip"] as v}<option value={v}>{({ none: t("Anything"), email: t("Email"), phone: t("Phone"), number: t("Number"), date: t("Date"), zip: t("Postal code") })[v]}</option>{/each}</select></div>
        {#if !sel.sender}<div><p class="mb-1 text-xs text-mute">{t("Prefill (merge field, optional)")}</p><input class="field !py-1.5" value={sel.default ?? ""} placeholder={"{{signer.name}}"} oninput={(e) => patch(sel.id, { default: e.currentTarget.value || undefined })} onchange={commit} /></div>{/if}
      {/if}
      {#if !isMark(sel.type) && !["payment", "file", "image"].includes(sel.type)}
        <div><p class="mb-1 text-xs text-mute">{t("Placeholder")}</p><input class="field !py-1.5" value={sel.placeholder ?? ""} oninput={(e) => patch(sel.id, { placeholder: e.currentTarget.value || undefined })} onchange={commit} data-testid="field-placeholder" /></div>
        <div><p class="mb-1 text-xs text-mute">{t("Tooltip")}</p><input class="field !py-1.5" value={sel.tooltip ?? ""} oninput={(e) => patch(sel.id, { tooltip: e.currentTarget.value || undefined })} onchange={commit} data-testid="field-tooltip" /></div>
      {/if}
      {#if sel.type === "text" && !sel.autofill && !sel.sender && sel.default}<label class="flex items-center justify-between text-sm">{t("Signer cannot change it")} <input type="checkbox" checked={sel.locked === true} onchange={(e) => { patch(sel.id, { locked: e.currentTarget.checked ? true : undefined }); commit(); }} data-testid="field-locked" /></label>{/if}
      {#if sel.type === "dropdown" || sel.type === "multiselect"}<OptionEditor options={sel.options ?? []} value={sel.default ?? ""} locked={sel.locked === true} multi={sel.type === "multiselect"} onchange={(v) => { patch(sel.id, { options: v.options, default: v.default || undefined, locked: v.locked && !sel.sender ? true : undefined }); commit(); }} testid="pp-opt" />{/if}
      {#if sel.type === "payment"}
        <div class="space-y-2 rounded-lg border border-line p-2" data-testid="payment-settings">
          <!-- Run 9 Part 3.7 (Pay 1, R9-l): who pays is the person this box belongs to, and they pay last -->
          <div class="rounded-md bg-tint px-2 py-1.5 text-xs" data-testid="pay-who"><p><span class="text-mute">{t("Who pays")}:</span> <strong>{seats?.find((x) => x.key === sel.role)?.label ?? sel.role}</strong></p>
            <p class="mt-1 text-mute">{t("They pay as the last step of signing. The document only completes once the payment goes through.")}</p>
            <p class="mt-1 text-mute">{t("Their receipt is emailed with the signed copy, and the payment shows on your Payments page.")}</p></div>
          <div><p class="mb-1 text-xs text-mute">{t("How the amount is set")}</p><select class="field !py-1.5" value={payKind(sel)} onchange={(e) => setPayKind(sel, e.currentTarget.value)} aria-label={t("How the amount is set")} data-testid="pay-kind"><option value="fixed">{t("A fixed amount")}</option><option value="ask">{t("An amount the signer chooses")}</option><option value="formula">{t("A formula from other fields")}</option><option value="price">{t("A Stripe price")}</option><option value="link">{t("A Stripe payment link")}</option>{#if payKind(sel) === "custom"}<option value="custom">{t("A custom value")}</option>{/if}</select></div>
          {#if payKind(sel) === "fixed"}<div><p class="mb-1 text-xs text-mute">{t("Amount ({currency})", { currency: (sel.currency ?? "usd").toUpperCase() })}</p><input class="field !py-1.5" inputmode="decimal" value={((sel.amount_minor ?? 0) / 100).toFixed(2)} onchange={(e) => { const n = Math.round(Number(e.currentTarget.value) * 100); if (n >= 50) patch(sel.id, { amount_minor: n }); commit(); }} aria-label={t("Amount")} data-testid="pay-amount" /></div>{/if}
          {#if payKind(sel) === "fixed"}
            <div><p class="mb-1 text-xs text-mute">{t("How it is collected")}</p><select class="field !py-1.5" value={fixedMode(sel)} onchange={(e) => setFixedMode(sel, e.currentTarget.value)} aria-label={t("How it is collected")} data-testid="pay-mode"><option value="once">{t("All at once")}</option><option value="deposit">{t("A deposit now")}</option><option value="installments" disabled={entitled("recurring_payments") === false}>{t("In installments")} · {t("Pro")}</option><option value="subscription" disabled={entitled("recurring_payments") === false}>{t("Every period until cancelled")} · {t("Pro")}</option></select>{#if entitled("recurring_payments") === false}<div class="mt-1"><ProLock item="recurring_payments" badgeOnly tip={t("Installments and subscriptions are part of Pro. A one-time payment, a deposit and an amount the signer chooses work on every plan.")} /></div>{/if}</div>
            {#if sel.deposit}<div class="flex gap-2"><div class="grow"><p class="mb-1 text-xs text-mute">{t("Deposit")}</p><select class="field !py-1.5" value={"percent" in sel.deposit ? "percent" : "amount"} onchange={(e) => { patch(sel.id, { deposit: e.currentTarget.value === "percent" ? { percent: 25 } : { amount_minor: Math.max(50, Math.round((sel.amount_minor ?? 5000) / 4)) } }); commit(); }} data-testid="pay-deposit-kind"><option value="percent">{t("A percent of the total")}</option><option value="amount">{t("A fixed amount")}</option></select></div>
              <div class="w-28"><p class="mb-1 text-xs text-mute">{"percent" in sel.deposit ? "%" : (sel.currency ?? "usd").toUpperCase()}</p><input class="field !py-1.5" inputmode="decimal" value={"percent" in sel.deposit ? sel.deposit.percent : (sel.deposit.amount_minor / 100).toFixed(2)} onchange={(e) => { const v = Number(e.currentTarget.value); if ("percent" in sel.deposit) { if (Number.isInteger(v) && v >= 1 && v <= 99) patch(sel.id, { deposit: { percent: v } }); } else if (Math.round(v * 100) >= 50) patch(sel.id, { deposit: { amount_minor: Math.round(v * 100) } }); commit(); }} aria-label={t("Deposit")} data-testid="pay-deposit" /></div></div>{/if}
            {#if sel.plan}<div class="flex gap-2"><div class="grow"><p class="mb-1 text-xs text-mute">{t("Every")}</p><select class="field !py-1.5" value={sel.plan.every} onchange={(e) => { patch(sel.id, { plan: { ...sel.plan, every: e.currentTarget.value } }); commit(); }} data-testid="pay-every"><option value="week">{t("week")}</option><option value="month">{t("month")}</option><option value="year">{t("year")}</option></select></div>
              {#if sel.plan.count}<div class="w-28"><p class="mb-1 text-xs text-mute">{t("Payments")}</p><input class="field !py-1.5" type="number" min="2" max="60" value={sel.plan.count} onchange={(e) => { const v = Number(e.currentTarget.value); if (Number.isInteger(v) && v >= 2 && v <= 60) patch(sel.id, { plan: { ...sel.plan, count: v } }); commit(); }} aria-label={t("Payments")} data-testid="pay-count" /></div>{/if}</div>
              <p class="text-xs text-mute">{t("Stripe runs the schedule and the retries. Refunds of a repeating payment are made in Stripe.")}</p>{/if}
          {/if}
          {#if payKind(sel) === "ask"}<div class="grid grid-cols-3 gap-2" data-testid="pay-ask">{#each [["min_minor", t("Smallest")], ["suggested_minor", t("Suggested")], ["max_minor", t("Largest")]] as [k, label]}<div><p class="mb-1 text-xs text-mute">{label}</p><input class="field !py-1.5" inputmode="decimal" value={sel.amount_ask?.[k] ? (sel.amount_ask[k] / 100).toFixed(2) : ""} placeholder="—" onchange={(e) => askBound(sel, k, e.currentTarget.value)} aria-label={label} data-testid={`pay-ask-${k}`} /></div>{/each}</div>{/if}
          {#if payKind(sel) === "formula"}
            <div><p class="mb-1 text-xs text-mute">{t("Formula (numbers, fields, + − × ÷ and brackets)")}</p><input class="field !py-1.5 font-mono text-xs" value={sel.amount_formula ?? ""} placeholder="quantity * unit_price * (1 + 8 / 100)" onchange={(e) => { patch(sel.id, { amount_formula: e.currentTarget.value.trim() || "1" }); commit(); }} aria-label={t("Formula")} data-testid="pay-formula" /></div>
            <div><p class="mb-1 text-xs text-mute">{t("Click a field to add it (this person's text fields)")}</p><div class="flex flex-wrap gap-1">{#each fields.filter((x) => x.role === sel.role && x.type === "text" && x.id !== sel.id) as o}<button type="button" class="rounded border border-line px-1.5 py-0.5 text-xs" onclick={() => { patch(sel.id, { amount_formula: `${sel.amount_formula ?? ""}${sel.amount_formula ? " " : ""}${o.id}` }); commit(); }}>{o.label || o.id} <span class="text-mute">{o.id}</span></button>{:else}<span class="text-xs text-mute">{t("No text fields for this person yet.")}</span>{/each}</div></div>
          {/if}
          {#if payKind(sel) === "price"}<div><p class="mb-1 text-xs text-mute">{t("Stripe price id")}</p><input class="field !py-1.5 font-mono text-xs" value={sel.price_id ?? ""} placeholder="price_1AbC…" onchange={(e) => { patch(sel.id, { price_id: e.currentTarget.value.trim() || "price_ReplaceThis" }); commit(); }} aria-label={t("Stripe price id")} data-testid="pay-price" /></div>{/if}
          {#if payKind(sel) === "link"}<div><p class="mb-1 text-xs text-mute">{t("Stripe payment link")}</p><input class="field !py-1.5 font-mono text-xs" value={sel.payment_link ?? ""} placeholder="https://buy.stripe.com/…" onchange={(e) => { patch(sel.id, { payment_link: e.currentTarget.value.trim() || "https://buy.stripe.com/replace_this" }); commit(); }} aria-label={t("Stripe payment link")} data-testid="pay-link" /></div>{/if}
          <p class="text-xs text-mute" data-testid="pay-fee-line">{t("Docustay fee: 2% on Free, 0% on Pro, plus Stripe's fees. The payment goes to the Stripe account connected in Settings → Payments.")}</p>
        </div>
      {/if}
      {#if !["date_signed"].includes(sel.type)}
        <details class="rounded-lg border border-line p-2" open={Boolean(sel.show_when || sel.calc)} data-testid="field-rules"><summary class="cursor-pointer text-sm">{t("Rules")}{#if sel.show_when || sel.calc}<span class="ml-1 text-xs text-mute">· {[sel.show_when ? t("shown only when a rule holds") : "", sel.calc ? t("works itself out") : ""].filter(Boolean).join(" · ")}</span>{/if}</summary>
          <div class="mt-2 space-y-3">
            <div><p class="mb-1 text-xs text-mute">{t("Show this box only when")}</p>
              <RuleEditor rule={sel.show_when ?? null} choices={ruleChoices(sel.locked ? 0.5 : stepOf(sel.role), sel.id)} onchange={(r) => { patch(sel.id, { show_when: r ?? undefined }); commit(); }} testid="field-rule" note={t("A rule can use what you lock in, or answers from people who sign before {who}. A box that is not shown is not asked for and is not in the signed copy.", { who: seatName(sel.role) })} /></div>
            {#if sel.type === "text" && !sel.autofill}
              <div><p class="mb-1 text-xs text-mute">{t("Works itself out (a formula)")}</p>
                <input class="field !py-1.5 font-mono text-xs" value={formulaShown(sel.calc)} placeholder="[Monthly rent] * [Months]" onchange={(e) => setCalc(sel, e.currentTarget.value)} aria-label={t("Formula")} data-testid="field-calc" />
                {#if calcMsg}<p class="mt-1 text-xs text-bad" role="alert" data-testid="field-calc-msg">{calcMsg}</p>{/if}
                <div class="mt-1 flex flex-wrap gap-1">{#each fields.filter((x) => x.id !== sel.id && x.type === "text" && (x.locked || stepOf(x.role) <= stepOf(sel.role))) as o}<button type="button" class="rounded border border-line px-1.5 py-0.5 text-xs" onclick={() => setCalc(sel, `${formulaShown(sel.calc)}${sel.calc ? " " : ""}[${o.label || o.id}]`)}>{o.label || o.id}</button>{/each}</div>
                {#if sel.calc}<div class="mt-2 flex items-center gap-2 text-xs"><label for="calc-places">{t("Decimal places")}</label><input id="calc-places" class="field !w-16 !py-1 text-xs" type="number" min="0" max="6" value={sel.places ?? 2} onchange={(e) => { const v = Number(e.currentTarget.value); if (Number.isInteger(v) && v >= 0 && v <= 6) { patch(sel.id, { places: v }); commit(); } }} data-testid="field-calc-places" /></div>
                  <p class="mt-1 text-xs text-mute">{t("The signer cannot type in it. The server works it out again when they sign, and the signed copy prints that answer.")}</p>{/if}
              </div>{/if}
          </div></details>
      {/if}
      {#if ["initials", "signature", "date_signed"].includes(sel.type)}<label class="flex items-center justify-between text-sm">{t("Repeat on every page")} <input type="checkbox" checked={sel.repeat === "every_page"} onchange={(e) => { patch(sel.id, { repeat: e.currentTarget.checked ? "every_page" : undefined }); commit(); }} /></label>{/if}
      <div class="flex gap-1.5"><button class="btn !py-1 !text-sm" onclick={() => duplicate(sel.id)}>{t("Duplicate")}</button><button class="btn !py-1 !text-sm" onclick={() => remove(sel.id)} data-testid="field-delete">{t("Delete")}</button></div>
      {#if body.file.page_count > 1}<div><p class="mb-1 text-xs text-mute">{t("Copy to page")}</p><select class="field !py-1.5" onchange={(e) => { if (e.currentTarget.value) { duplicate(sel.id, Number(e.currentTarget.value)); e.currentTarget.value = ""; } }} aria-label={t("Copy to page")}><option value="">{t("Choose…")}</option>{#each Array.from({ length: body.file.page_count }, (_, i) => i + 1).filter((p) => p !== sel.page) as p}<option value={p}>{t("Page {n}", { n: p })}</option>{/each}</select></div>{/if}
    {/if}
  </aside>
</div>
{/if}
